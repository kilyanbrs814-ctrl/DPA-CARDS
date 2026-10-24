/**
 * DPA Cards — synchronisation des tampons PNG depuis Google Drive.
 * Préparation unique :
 *  1. Créer un projet sur https://script.google.com sous le compte propriétaire du Drive.
 *  2. Coller ce fichier dans Code.gs.
 *  3. Paramètres du projet > Propriétés de script > ajouter DPA_STAMP_TOKEN.
 *     La valeur est lisible dans Supabase SQL Editor :
 *     select token from app_private.drive_stamp_sync_connection where id=true;
 *     Ne jamais coller cette valeur dans le code GitHub.
 *  4. Exécuter installerSynchronisation() une seule fois et autoriser Google Drive.
 * Le déclencheur vérifiera le dossier privé toutes les 5 minutes.
 */

const DPA_STAMP_FOLDER = '1vSy2iXweuL8325u4a8-5mLlCdBj0_c3-';
const DPA_STAMP_ENDPOINT = 'https://fiuffxchvjcghcvfaout.supabase.co/functions/v1/stamp-sync/import';
const MAX_PAR_EXECUTION = 8;

function synchroniserTamponsDpa() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('DPA_STAMP_TOKEN');
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
    throw new Error('Configure DPA_STAMP_TOKEN dans les propriétés du script avant toute synchronisation.');
  }
  const folder = DriveApp.getFolderById(DPA_STAMP_FOLDER);
  const files = folder.getFiles();
  let uploaded = 0, skipped = 0;
  while (files.hasNext() && uploaded < MAX_PAR_EXECUTION) {
    const file = files.next();
    if (file.getMimeType() !== 'image/png') { skipped++; continue; }
    const fileId = file.getId();
    const modifiedTime = file.getLastUpdated().toISOString();
    const stateKey = 'IMPORTED_' + fileId;
    if (props.getProperty(stateKey) === modifiedTime) { skipped++; continue; }
    if (file.getSize() > 4000000) {
      console.warn('Image trop volumineuse (>4 Mo) : ' + file.getName());
      continue;
    }
    const payload = {
      folderId: DPA_STAMP_FOLDER,
      fileId,
      fileName: file.getName(),
      modifiedTime,
      base64: Utilities.base64Encode(file.getBlob().getBytes()),
    };
    const result = UrlFetchApp.fetch(DPA_STAMP_ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-dpa-stamp-token': token },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    const status = result.getResponseCode();
    if (status < 200 || status >= 300) {
      // Never mark a failed import as complete.
      console.error('Import échoué : ' + file.getName() + ' (' + status + ') ' +
        result.getContentText().slice(0, 300));
      continue;
    }
    props.setProperty(stateKey, modifiedTime);
    uploaded++;
    console.log('Tampon synchronisé : ' + file.getName());
  }
  console.log('Synchronisation terminée : ' + uploaded + ' importés, ' + skipped + ' inchangés.');
}

function installerSynchronisation() {
  const existing = ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'synchroniserTamponsDpa');
  for (const trigger of existing) ScriptApp.deleteTrigger(trigger);
  ScriptApp.newTrigger('synchroniserTamponsDpa').timeBased().everyMinutes(5).create();
  synchroniserTamponsDpa();
}

function voirEtatSynchronisation() {
  const props = PropertiesService.getScriptProperties();
  console.log('Dossier : ' + DPA_STAMP_FOLDER);
  console.log('Secret configuré : ' + !!props.getProperty('DPA_STAMP_TOKEN'));
  console.log('Déclencheurs actifs : ' +
    ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'synchroniserTamponsDpa').length);
}
