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

test('Apple larger name and logo share one vertically centered bitmap without adding header height',async({page})=>{
 await page.goto('/scripts/fixtures/designer.html');
 const bitmap=await page.evaluate(async()=>{
   const {createAppleWordmark}=await import('/src/apple-wordmark.js');
   const logo=document.createElement('canvas');logo.width=90;logo.height=90;
   const gc=logo.getContext('2d');gc.fillStyle='#FF6A33';gc.fillRect(10,10,70,70);
   const d={identity:{name:'Barber Factory'},colors:{primary:'#10436B',text:'#FFFFFF'},apple:{showBusinessName:true,colors:{}},
     assets:{logo:{url:logo.toDataURL('image/png')}}};
   const blob=await createAppleWordmark(d);
   const img=await createImageBitmap(blob);
   const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
   const c=canvas.getContext('2d');c.drawImage(img,0,0);
   const data=c.getImageData(0,0,img.width,img.height).data;
   let minY=img.height,maxY=-1;
   for(let y=0;y<img.height;y++)for(let x=0;x<img.width;x++)
     if(data[(y*img.width+x)*4+3]>30){minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
   return {width:img.width,height:img.height,centering:(minY+maxY)/2,opaque:Math.max(0,maxY-minY)};
 });
 expect(bitmap.width).toBe(480);
 expect(bitmap.height).toBe(150);
 expect(bitmap.opaque).toBeGreaterThan(45);
 expect(Math.abs(bitmap.centering-75)).toBeLessThan(9);
 const preview=page.locator('[data-layout="apple"]').first();
 const beforeCard=await preview.boundingBox();
 const beforeStamp=await preview.locator('[data-progress="stamps"]').first().boundingBox();
 const beforeOffset=beforeStamp.y-beforeCard.y;
 await page.getByRole('button',{name:/Afficher le nom du commerce/}).click();
 const afterCard=await preview.boundingBox();
 const stamp=await preview.locator('[data-progress="stamps"]').first().boundingBox();
 const afterOffset=stamp.y-afterCard.y;
 expect(Math.abs(beforeOffset-afterOffset)).toBeLessThan(1);
 expect(afterOffset).toBeGreaterThan(70);
});

test('last stamp is a gray reward star, label color can be edited, and the Apple name font is selectable',async({page})=>{
 await page.goto('/scripts/fixtures/designer.html');
 const apple=page.locator('[data-layout="apple"]').first();
 const google=page.locator('[data-layout="google"]').first();
 await expect(apple.locator('[data-stamp="empty-final-star"]')).toHaveCount(1);
 const star=apple.locator('[data-stamp="empty-final-star"]');
 await expect(star).toHaveAttribute('src','/assets/stamps/reward-star.png');
 await page.getByRole('tab',{name:/Google Wallet/}).click();
 await expect(google.locator('[data-stamp="empty-final-star"]')).toHaveCount(1);
 await page.getByRole('tab',{name:/Apple Wallet/}).click();
 const nameFont=page.getByLabel('Police du nom');
 await expect(nameFont).toHaveValue('system');
 await nameFont.selectOption('playfair');
 await expect(nameFont).toHaveValue('playfair');
 const rewardSection=page.locator('[data-apple-reward-settings]');
 await rewardSection.getByLabel('Afficher la récompense dans le bloc des tampons').check();
 await expect(apple.locator('[data-apple-reward]')).toContainText('Débloque');
 await expect(rewardSection.getByText('Couleur du texte de récompense')).toBeVisible();
 await rewardSection.getByRole('button',{name:'Revenir à la couleur automatique'}).count().then(n=>expect(n).toBe(0));
});

test('long Apple merchant names stay on exactly one line and arbitrary reward hex colors are honored',async({page})=>{
 await page.goto('/scripts/fixtures/designer.html');
 const result=await page.evaluate(async()=>{
   const [{createAppleWordmark},{rewardLabelColor,createRewardLabel}]=await Promise.all([
     import('/src/apple-wordmark.js'),import('/src/apple-reward-label.js')]);
   const design={
     identity:{name:'BARBER FACTORY PREMIUM EXPRESS'},
     colors:{primary:'#173657',secondary:'#EABF35',text:'#FFFFFF'},
     apple:{businessNameFont:'system',rewardText:'Débloque la coupe offerte !',rewardTextColor:'#FF00CC'},
     assets:{logo:null}
   };
   const blob=await createAppleWordmark(design),img=await createImageBitmap(blob);
   const cvs=document.createElement('canvas');cvs.width=img.width;cvs.height=img.height;
   const ctx=cvs.getContext('2d');ctx.drawImage(img,0,0);
   const pix=ctx.getImageData(0,0,img.width,img.height).data;
   let top=img.height,bottom=0;
   for(let y=0;y<img.height;y++)for(let x=0;x<img.width;x++)
      if(pix[(y*img.width+x)*4+3]>60){top=Math.min(top,y);bottom=Math.max(bottom,y);}
   const reward=await createRewardLabel(design);
   return {width:img.width,height:img.height,textHeight:bottom-top+1,color:rewardLabelColor(design),rewardSize:reward.size};
 });
 expect(result.width).toBe(480);
 expect(result.height).toBe(150);
 expect(result.textHeight).toBeGreaterThan(10);
 expect(result.textHeight).toBeLessThan(68);
 expect(result.color).toBe('#FF00CC');
 expect(result.rewardSize).toBeGreaterThan(1000);
});

test('optional name-only transparent PNG sits beside original logo, persists and can be removed',async({page})=>{
 await page.goto('/scripts/fixtures/designer.html');
 const preview=page.locator('[data-layout="apple"]').first();
 const header=preview.locator('[data-field="card-number"]');
 const stamp=preview.locator('[data-progress="stamps"]').first();
 const yBefore=(await stamp.boundingBox()).y-(await preview.boundingBox()).y;
 const logo=fixture(120,120,[220,60,35,255]);
 const name=fixture(400,80,[30,230,100,255]);
 await page.locator('[data-upload="logo"]').setInputFiles({name:'logo.png',mimeType:'image/png',buffer:logo});
 await page.locator('[data-upload="businessNameImage"]').setInputFiles({name:'barber-name.png',mimeType:'image/png',buffer:name});
 await expect(preview.getByRole('img',{name:'Image du nom du commerce'})).toHaveCount(1);
 await expect(page.getByRole('button',{name:/Afficher le nom du commerce/})).toHaveAttribute('aria-pressed','true');
 await expect(header).toContainText('1234');
 const yAfter=(await stamp.boundingBox()).y-(await preview.boundingBox()).y;
 expect(Math.abs(yAfter-yBefore)).toBeLessThan(1);
 await page.getByRole('button',{name:/Enregistrer/}).click();
 await expect(page.locator('#toast')).toHaveText('Carte test enregistrée.');
 await expect(preview.getByRole('img',{name:'Logo et nom du commerce'})).toHaveCount(1);
 const data=await page.evaluate(async()=>{
   const raw=localStorage.getItem('test-design'),saved=JSON.parse(raw);
   const {createAppleWordmark}=await import('/src/apple-wordmark.js');
   const combined=await createAppleWordmark(saved.config);
   const bitmap=await createImageBitmap(combined),c=document.createElement('canvas');
   c.width=bitmap.width;c.height=bitmap.height;
   const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);
   const arr=ctx.getImageData(0,0,c.width,c.height).data;
   let logoInk=0,nameInk=0;
   for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
     const i=(y*c.width+x)*4;
     if(arr[i+3]<32)continue;
     if(x<c.width*.32&&arr[i]>arr[i+1]*1.5)logoInk++;
     if(x>c.width*.34&&arr[i+1]>arr[i]*1.5)nameInk++;
   }
   return {hasName:!!saved.config.assets.businessNameImage?.path,headerVersion:saved.config.apple.headerArtworkVersion,
      width:bitmap.width,height:bitmap.height,logoInk,nameInk};
 });
 expect(data).toMatchObject({hasName:true,headerVersion:2,width:480,height:150});
 expect(data.logoInk).toBeGreaterThan(30);
 expect(data.nameInk).toBeGreaterThan(30);
 await page.reload();
 await expect(preview.getByRole('img',{name:'Logo et nom du commerce'})).toHaveCount(1);
 await page.locator('[data-upload="businessNameImage"]').locator('..').getByRole('button',{name:'Retirer',exact:true}).click();
 await page.getByRole('button',{name:/Enregistrer/}).click();
 await expect(page.locator('#toast')).toHaveText('Carte test enregistrée.');
 const fallback=await page.evaluate(()=>JSON.parse(localStorage.getItem('test-design')).config);
 expect(fallback.assets.businessNameImage).toBeNull();
 expect(fallback.assets.appleHeader.path).toBeTruthy();
});

test('opaque or blank name image is rejected while preserving original Apple header',async({page})=>{
 await page.goto('/scripts/fixtures/designer.html');
 const before=await page.locator('[data-layout="apple"]').first().boundingBox();
 const notPng=Buffer.from('not a png');
 await page.locator('[data-upload="businessNameImage"]').setInputFiles({name:'invalid.png',mimeType:'image/png',buffer:notPng});
 await expect(page.locator('#toast')).toContainText('PNG invalide');
 const after=await page.locator('[data-layout="apple"]').first().boundingBox();
 expect(after.height).toBe(before.height);
 await expect(page.locator('[data-layout="apple"]').first().getByRole('img',{name:'Image du nom du commerce'})).toHaveCount(0);
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
