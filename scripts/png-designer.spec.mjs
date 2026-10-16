import {test,expect} from '@playwright/test';
import {fixture} from './fixtures/png.mjs';
test('upload PNG, preview both states, persist, replace, remove and reject invalid files',async({page})=>{
 await page.goto('/scripts/fixtures/designer.html');
 const upload=kind=>page.locator(`[data-upload="${kind}"]`);
 const png=fixture(80,40);
 await upload('logo').setInputFiles({name:'logo.png',mimeType:'image/png',buffer:png});
 await upload('stamp').setInputFiles({name:'stamp.png',mimeType:'image/png',buffer:png});
 const preview=page.locator('[data-layout="apple"]').first();
 await expect(preview.locator('[data-stamp="filled-png"]')).toHaveCount(3);
 await expect(preview.locator('[data-stamp="empty-png"]')).toHaveCount(6);
 await expect(preview.locator('[data-stamp="empty-final-star"]')).toHaveCount(1);
 await expect(preview.locator('[data-stamp="empty-final-star"]')).toHaveCSS('filter','grayscale(1)');
 await expect(preview.locator('[data-stamp="empty-final-star"]')).toHaveCSS('opacity','0.22');
 await expect(preview.locator('[data-stamp="empty-png"]').first()).toHaveCSS('opacity','0.22');
 await expect(preview.locator('[data-stamp="empty-png"]').first()).toHaveCSS('filter','grayscale(1)');
 await expect(preview.locator('[data-field="business"]')).toHaveCount(0);
 await page.getByRole('button',{name:/Enregistrer/}).click();
 await expect(page.locator('#toast')).toHaveText('Carte test enregistrée.');
 await page.reload();
 await expect(preview.locator('[data-stamp="filled-png"]')).toHaveCount(3);
 const before=await preview.locator('[data-stamp="filled-png"]').first().getAttribute('src');
 await upload('stamp').setInputFiles({name:'replacement.png',mimeType:'image/png',buffer:fixture(40,80,[0,170,240,255])});
 await expect(preview.locator('[data-stamp="filled-png"]').first()).not.toHaveAttribute('src',before);
 await upload('stamp').setInputFiles({name:'bad.png',mimeType:'image/png',buffer:Buffer.from('not a png')});
 await expect(page.locator('#toast')).toContainText('PNG invalide');
 await page.screenshot({path:'/tmp/dpa-png-designer.png',fullPage:true});
 // Remove through the same ImagePick component as the real generator.
 await upload('stamp').locator('..').getByRole('button',{name:'Retirer',exact:true}).click();
 await expect(preview.locator('[data-stamp="filled-png"]')).toHaveCount(0);
 await upload('logo').locator('..').getByRole('button',{name:'Retirer',exact:true}).click();
 await page.getByRole('button',{name:/Enregistrer/}).click();
 await page.reload();
 await expect(preview.getByRole('img',{name:'Logo',exact:true})).toHaveCount(0);
 await expect(preview.locator('[data-stamp="filled-png"]')).toHaveCount(0);
});

test('Apple native name toggle keeps the header height, logo and stamp position',async({page})=>{
 await page.goto('/scripts/fixtures/designer.html');
 const preview=page.locator('[data-layout="apple"]').first();
 const stamp=preview.locator('[data-progress="stamps"]').first();
 const beforeCard=await preview.boundingBox(),beforeStamp=await stamp.boundingBox();
 await page.getByRole('button',{name:/Afficher le nom du commerce/}).click();
 await expect(preview.locator('[data-field="apple-native-business-name"]')).toHaveText('PNG browser test');
 await expect(preview.getByRole('img',{name:'Logo et nom du commerce'})).toHaveCount(0);
 const afterCard=await preview.boundingBox(),afterStamp=await stamp.boundingBox();
 expect(Math.abs((afterStamp.y-afterCard.y)-(beforeStamp.y-beforeCard.y))).toBeLessThan(1);
});
test('last stamp and reward label stay editable, but Apple name font is native',async({page})=>{
 await page.goto('/scripts/fixtures/designer.html');
 const apple=page.locator('[data-layout="apple"]').first();
 await expect(apple.locator('[data-stamp="empty-final-star"]')).toHaveCount(1);
 await expect(page.getByLabel('Police du nom')).toHaveCount(0);
 await expect(page.locator('[data-upload="businessNameImage"]')).toHaveCount(0);
 await expect(page.locator('[data-upload="businessFont"]')).toHaveCount(0);
 const reward=page.locator('[data-apple-reward-settings]');
 await reward.getByLabel('Afficher la récompense dans le bloc des tampons').check();
 await expect(apple.locator('[data-apple-reward]')).toContainText('Débloque');
});
test('native merchant name stays single-line; reward color still works',async({page})=>{
 await page.goto('/scripts/fixtures/designer.html');
 await page.getByRole('button',{name:/Afficher le nom du commerce/}).click();
 const name=page.locator('[data-layout="apple"] [data-field="apple-native-business-name"]').first();
 await expect(name).toHaveCSS('white-space','nowrap');
 const color=await page.evaluate(async()=> {
   const {rewardLabelColor}=await import('/src/apple-reward-label.js');
   return rewardLabelColor({colors:{primary:'#173657',text:'#FFFFFF'},apple:{rewardTextColor:'#FF00CC'}});
 });
 expect(color).toBe('#FF00CC');
});
test('saved Apple pass uses only original logo and native merchant text',async({page})=>{
 await page.goto('/scripts/fixtures/designer.html');
 const preview=page.locator('[data-layout="apple"]').first();
 const logo=fixture(120,120,[220,60,35,255]);
 await page.locator('[data-upload="logo"]').setInputFiles({name:'logo.png',mimeType:'image/png',buffer:logo});
 await page.getByRole('button',{name:/Afficher le nom du commerce/}).click();
 await expect(preview.getByRole('img',{name:'Logo',exact:true})).toHaveCount(1);
 await expect(preview.locator('[data-field="apple-native-business-name"]')).toHaveText('PNG browser test');
 await page.getByRole('button',{name:/Enregistrer/}).click();
 await expect(page.locator('#toast')).toHaveText('Carte test enregistrée.');
 const cfg=await page.evaluate(()=>JSON.parse(localStorage.getItem('test-design')).config);
 expect(cfg.apple.showBusinessName).toBe(true);
 expect(cfg.assets.appleHeader).toBeNull();
 expect(cfg.assets.businessNameImage).toBeNull();
 expect(cfg.apple.headerArtworkVersion).toBe(0);
 await page.reload();
 await expect(preview.locator('[data-field="apple-native-business-name"]')).toHaveText('PNG browser test');
 await expect(preview.getByRole('img',{name:'Logo et nom du commerce'})).toHaveCount(0);
});
test('legacy combined header images remain ignored in editor',async({page})=>{
 await page.goto('/scripts/fixtures/designer.html');
 await page.evaluate(()=>{
  const initial={id:'33333333-3333-4333-8333-333333333333',name:'Legacy card',qr_token:'demo-token',qr_value:'DPA_TEST:demo-token',card_number:'TEST 1234',
   config:{identity:{name:'Barber Factory'},apple:{showBusinessName:true,headerArtworkVersion:3},
    assets:{appleHeader:{path:'tests/33333333-3333-4333-8333-333333333333/designer/appleHeader-11111111-1111-4111-8111-111111111111.png',url:'/assets/does-not-matter.png'}},
    preview:{progress:3,goal:10},stamps:{icon:'emoji',emoji:'🍔'}}};
  localStorage.setItem('test-design',JSON.stringify(initial));
 });
 await page.reload();
 const preview=page.locator('[data-layout="apple"]').first();
 await expect(preview.locator('[data-field="apple-native-business-name"]')).toHaveText('Barber Factory');
 await expect(preview.getByRole('img',{name:'Logo et nom du commerce'})).toHaveCount(0);
 await page.getByRole('button',{name:/Enregistrer/}).click();
 const cfg=await page.evaluate(()=>JSON.parse(localStorage.getItem('test-design')).config);
 expect(cfg.assets.appleHeader).toBeNull();
});
test('Apple stamp rectangle can be toggled off and on without moving counters or QR; Google stays unchanged',async({page})=>{
 await page.goto('/scripts/fixtures/designer.html');
 const apple=page.locator('[data-layout="apple"]').first();
 const panel=apple.locator('[data-apple-stamp-panel]');
 const checkbox=page.getByLabel('Afficher le rectangle des tampons');
 await expect(checkbox).toBeChecked();
 await expect(panel).toHaveAttribute('data-apple-stamp-panel','visible');
 const rewardToggle=page.locator('[data-apple-reward-settings]').getByLabel('Afficher la récompense dans le bloc des tampons');
 await rewardToggle.check();
 await expect(panel.locator('[data-apple-reward]')).toBeVisible();
 const before=await apple.boundingBox();
 const countersBefore=await apple.locator('[data-field="completed-count"]').boundingBox();
 const remainingBefore=await apple.locator('[data-field="remaining-count"]').boundingBox();
 const qrBefore=await apple.locator('[data-field="qr"]').boundingBox();
 await checkbox.uncheck();
 await expect(panel).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 await expect(panel.locator('[data-progress="stamps"]')).toBeVisible();
 await expect(panel.locator('[data-stamp]')).toHaveCount(10);
 await expect(panel.locator('[data-stamp]').first()).toBeVisible();
 await expect(panel.locator('[data-stamp]').last()).toBeVisible();
 await expect(panel.locator('[data-apple-reward]')).toBeVisible();
 await expect(rewardToggle).toBeVisible();
 await expect(rewardToggle).toBeChecked();
 await expect(panel).toHaveAttribute('data-apple-stamp-panel','hidden');
 const after=await apple.boundingBox();
 const countersAfter=await apple.locator('[data-field="completed-count"]').boundingBox();
 const remainingAfter=await apple.locator('[data-field="remaining-count"]').boundingBox();
 const qrAfter=await apple.locator('[data-field="qr"]').boundingBox();
 expect(Math.abs(before.height-after.height)).toBeLessThan(1);
 // Compare offsets inside the card: clicking the setting scrolls the page viewport.
 expect(Math.abs((countersBefore.y-before.y)-(countersAfter.y-after.y))).toBeLessThan(1);
 expect(Math.abs((remainingBefore.y-before.y)-(remainingAfter.y-after.y))).toBeLessThan(1);
 expect(Math.abs((qrBefore.y-before.y)-(qrAfter.y-after.y))).toBeLessThan(1);
 await page.getByRole('button',{name:/Enregistrer/}).click();
 await expect(page.locator('#toast')).toHaveText('Carte test enregistrée.');
 await page.reload();
 await expect(checkbox).not.toBeChecked();
 await expect(panel).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 await expect(panel.locator('[data-progress="stamps"]')).toBeVisible();
 await expect(panel.locator('[data-stamp]')).toHaveCount(10);
 await expect(panel.locator('[data-stamp]').first()).toBeVisible();
 await expect(panel.locator('[data-stamp]').last()).toBeVisible();
 await expect(panel.locator('[data-apple-reward]')).toBeVisible();
 await page.getByRole('tab',{name:/Google Wallet/}).click();
 await expect(page.locator('[data-layout="google"]').first().locator('[data-progress="stamps"]')).toBeVisible();
 await page.getByRole('tab',{name:/Apple Wallet/}).click();
 await checkbox.check();
 await expect(panel).toHaveCSS('visibility','visible');
 await page.getByRole('button',{name:/Enregistrer/}).click();
 await page.reload();
 await expect(checkbox).toBeChecked();
 await expect(panel).toHaveCSS('visibility','visible');
});

test('Apple strip upload exports exactly the portrait or landscape area shown in the crop window',async({page})=>{
  for (const portrait of [true,false]) {
    await page.goto('/scripts/fixtures/designer.html');
    await page.evaluate(()=>localStorage.clear());
    await page.reload();
    const imageData=await page.evaluate(portrait=>{
      const c=document.createElement('canvas');
      c.width=portrait?680:1200;c.height=portrait?1020:450;
      const ctx=c.getContext('2d');
      ctx.fillStyle='#161C25';ctx.fillRect(0,0,c.width,c.height);
      // High-contrast, nonrepeating geometry makes an accidental top-left crop
      // observably different from the area visible in the dialog.
      for(let y=0;y<c.height;y+=60)for(let x=0;x<c.width;x+=60){
        ctx.fillStyle=`rgb(${(x*7+y*3)%256},${(x*3+y*5)%256},${(x*2+y*9)%256})`;
        ctx.fillRect(x,y,60,60);
      }
      ctx.fillStyle='#FF00FF';ctx.fillRect(c.width*.55,c.height*.4,100,110);
      return c.toDataURL('image/png').split(',')[1];
    },portrait);
    await page.locator('[data-upload="appleStrip"]').setInputFiles({
      name:portrait?'portrait.png':'landscape.png',mimeType:'image/png',buffer:Buffer.from(imageData,'base64')
    });
    const crop=page.getByRole('application',{name:/Zone de recadrage/});
    await expect(crop.locator('img')).toBeVisible();
    // Exercise different zoom and pan, not just the initial centered selection.
    const zoom=page.locator('[role="dialog"] input[type="range"]').first();
    await zoom.focus();
    for(let z=0;z<35;z++)await zoom.press('ArrowRight');
    const rect=await crop.boundingBox();
    await page.mouse.move(rect.x+rect.width*.5,rect.y+rect.height*.5);
    await page.mouse.down();
    await page.mouse.move(rect.x+rect.width*.6,rect.y+rect.height*.4,{steps:8});
    await page.mouse.up();
    const selected=await crop.screenshot();
    await page.getByRole('button',{name:'Valider le recadrage'}).click();
    const panel=page.locator('[data-layout="apple"] [data-apple-stamp-panel]').first();
    await expect(panel).toHaveCSS('background-image',/data:image\/png;base64/);
    const result=await panel.evaluate(async (el, screenshot)=>{
      const stored=el.style.backgroundImage.match(/data:image\/png;base64,[^"'\\)]+/);
      if(!stored)throw new Error('no uploaded cropped image');
      const load=async url=>{const im=new Image();im.src=url;await im.decode();return im;};
      const output=await load(stored[0]);
      const input=await load('data:image/png;base64,'+screenshot);
      const make=(img)=>{const c=document.createElement('canvas');c.width=375;c.height=144;c.getContext('2d').drawImage(img,0,0,375,144);return c.getContext('2d').getImageData(0,0,375,144).data;};
      const expected=make(input),actual=make(output);
      let error=0,count=0;
      for(let y=15;y<129;y+=2)for(let x=20;x<355;x+=2){
        const i=(y*375+x)*4;
        for(let k=0;k<3;k++){error+=Math.abs(expected[i+k]-actual[i+k]);count++;}
      }
      return {width:output.naturalWidth,height:output.naturalHeight,averageChannelError:error/count};
    },selected.toString('base64'));
    expect(result.width).toBe(1125);
    expect(result.height).toBe(432);
    expect(result.averageChannelError).toBeLessThan(19);
  }
});


test('Custom Apple header saves at Retina 3x, then Classic restores native name without deleting the custom image',async({page})=>{
 await page.goto('/scripts/fixtures/designer.html');
 const card=page.locator('[data-layout="apple"]').first();
 await page.locator('[data-upload="logo"]').setInputFiles({name:'barber-logo.png',mimeType:'image/png',buffer:fixture(120,120,[245,162,25,255])});
 await page.getByRole('button',{name:/Afficher le nom du commerce/}).click();
 await page.getByLabel('Nom du commerce').fill('Barber Factory');
 await page.getByLabel('Activité / sous-titre (facultatif)').fill('Coiffeur & Barbier');
 const stamp=card.locator('[data-progress="stamps"]').first();
 const before=await card.boundingBox(),beforeStamps=await stamp.boundingBox(),y=beforeStamps.y-before.y;
 await page.getByLabel('Style de l’en-tête').selectOption('custom');
 await expect(card.locator('[data-field="apple-custom-business-header"]')).toContainText('Coiffeur & Barbier');
 await page.getByRole('button',{name:/Enregistrer/}).click();
 await expect(page.locator('#toast')).toHaveText('Carte test enregistrée.');
 const custom=await page.evaluate(()=>JSON.parse(localStorage.getItem('test-design')).config);
 expect(custom.apple.headerMode).toBe('custom');
 expect(custom.apple.headerArtworkVersion).toBe(4);
 expect(custom.assets.appleHeader.path).toContain('appleHeader-');
 const img=card.getByRole('img',{name:'Logo, nom et activité du commerce'});
 await expect(img).toBeVisible();
 const bitmap=await img.evaluate(async el=>{await el.decode();return [el.naturalWidth,el.naturalHeight];});
 expect(bitmap).toEqual([480,150]);
 const after=await card.boundingBox(),afterStamps=await stamp.boundingBox();
 expect(Math.abs(afterStamps.y-after.y-y)).toBeLessThan(1);
 await page.getByLabel('Style de l’en-tête').selectOption('classic');
 await expect(card.locator('[data-field="apple-native-business-name"]')).toHaveText('Barber Factory');
 await page.getByRole('button',{name:/Enregistrer/}).click();
 const classic=await page.evaluate(()=>JSON.parse(localStorage.getItem('test-design')).config);
 expect(classic.apple.headerMode).toBe('classic');
 expect(classic.assets.appleHeader.path).toBe(custom.assets.appleHeader.path);
 await page.reload();
 await expect(card.locator('[data-field="apple-native-business-name"]')).toHaveText('Barber Factory');
 await page.getByLabel('Style de l’en-tête').selectOption('custom');
 await page.getByRole('button',{name:/Enregistrer/}).click();
 const again=await page.evaluate(()=>JSON.parse(localStorage.getItem('test-design')).config);
 expect(again.apple.headerArtworkVersion).toBe(4);
 expect(again.assets.appleHeader.path).toBe(custom.assets.appleHeader.path);
});
