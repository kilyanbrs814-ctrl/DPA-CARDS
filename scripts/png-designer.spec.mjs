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
 await expect(preview.locator('[data-stamp="empty-png"]')).toHaveCount(7);
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
 const headerBefore=await preview.locator('[data-field="card-number"]').boundingBox();
 await page.getByRole('button',{name:/Afficher le nom du commerce/}).click();
 const headerAfter=await preview.locator('[data-field="card-number"]').boundingBox();
 const stamp=await preview.locator('[data-progress="stamps"]').first().boundingBox();
 expect(Math.abs(headerBefore.y-headerAfter.y)).toBeLessThan(1);
 expect(stamp.y).toBeGreaterThan(headerAfter.y);
});
