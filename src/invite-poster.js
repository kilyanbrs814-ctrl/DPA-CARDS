// A4 print poster. The QR is drawn with vector modules and a four-module white quiet zone.
function literal(text) {
  return Array.from(String(text).normalize('NFC').replace(/\s+/g, ' '), char => {
    const code = char.codePointAt(0);
    if (char === '€') return '\\200';
    if (char === '’' || char === '‘') return "'";
    if (char === '–' || char === '—') return '-';
    if (code > 255 || code < 32) return '?';
    if (code > 126) return '\\' + code.toString(8).padStart(3, '0');
    return ['\\','(',')'].includes(char) ? '\\' + char : char;
  }).join('');
}

function merchantLines(name) {
  const normalized = Array.from(String(name || '').trim().replace(/\s+/g,' ')).slice(0,96).join('');
  const lines = (normalized || 'Votre commerce').match(/.{1,30}(?:\s|$)|.{1,30}/gu) || [];
  return lines.slice(0, 3).map((line, index) => line.trim() + (index === 2 && lines.length > 3 ? '...' : ''));
}

export function makeInvitePosterPdf({name, url, modules}) {
  const n = modules?.size;
  if (!Number.isInteger(n) || n < 21 || n > 177 || modules.data?.length !== n*n) {
    throw new Error('invalid_qr_matrix');
  }
  const pageW = 595.28, pageH = 841.89, qrSide = 266, cell = qrSide/(n+8);
  const x0 = (pageW-qrSide)/2, y0 = 224;
  const ops = [];
  const rgb = (r,g,b) => [r,g,b].map(v=>(v/255).toFixed(4)).join(' ');
  const purple = rgb(88,42,178), ink = rgb(28,19,54), soft = rgb(73,62,100);
  const rect = (x,y,w,h,color) => ops.push(color+' rg '+[x,y,w,h].map(v=>v.toFixed(4)).join(' ')+' re f');
  const label = (value,x,y,size,font,color) => ops.push('BT /'+font+' '+size+' Tf '+color+' rg '+x+' '+y+' Td ('+literal(value)+') Tj ET');
  rect(32,32,531,778,'0.974 0.963 1');
  rect(32,747,531,63,purple);
  label('DPA CARDS  /  FIDÉLITÉ',57,773,17,'F2','1 1 1');
  merchantLines(name).forEach((line,i) => label(line,57,717-i*24,19,'F2',purple));
  label('Votre carte de fidélité',57,611,37,'F2',ink);
  label('directement sur votre téléphone.',57,572,26,'F2',ink);
  label('Scannez le QR code pour rejoindre le programme.',57,528,17,'F1',soft);
  rect(x0-9,y0-9,qrSide+18,qrSide+18,'0.875 0.837 0.975');
  rect(x0,y0,qrSide,qrSide,'1 1 1');
  for (let row=0;row<n;row++) {
    for (let col=0;col<n;) {
      if (!modules.data[row*n+col]) { col++; continue; }
      const start=col++;
      while (col<n && modules.data[row*n+col]) col++;
      rect(x0+(start+4)*cell,y0+(n+3-row)*cell,(col-start)*cell,cell,'0 0 0');
    }
  }
  rect(57,146,481,45,purple);
  label('1. Scannez      2. Inscrivez-vous      3. Ajoutez la carte',74,163,17,'F2','1 1 1');
  label('Compatible Apple Wallet et Google Wallet',57,113,15,'F2',ink);
  const link=String(url).replace(/^https:\/\//,'');
  (link.match(/.{1,78}/g)||[]).slice(0,2).forEach((line,i) => label(line,57,86-i*13,10,'F1',soft));
  const stream=ops.join('\n')+'\n';
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+pageW+' '+pageH+'] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    '<< /Length '+stream.length+' >>\nstream\n'+stream+'endstream',
  ];
  let pdf='%PDF-1.4\n', offsets=[];
  objects.forEach((obj,i)=>{offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+obj+'\nendobj\n';});
  const xref=pdf.length;
  pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')
    +'trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
  return Uint8Array.from(pdf,c=>c.charCodeAt(0));
}
