export async function saveQrToPhotos(dataUrl,loadMedia=()=>import('@capacitor-community/media')) {
 if(!/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(dataUrl||''))throw new Error('invalid_qr_image');
 const {Media}=await loadMedia();
 // No album identifier: iOS only requests add-only photo access.
 await Media.savePhoto({path:dataUrl});
}
