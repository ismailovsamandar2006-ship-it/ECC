import QRCode from '../lib/vendor-qr/index.js';
import QRErrorCorrectLevel from '../lib/vendor-qr/QRErrorCorrectLevel.js';
export default async function handler(req,res){
  try{
    const code=String(req.query?.code||'');if(!/^\d{6}$/.test(code)){res.statusCode=400;return res.end('Неправильный код');}
    const host=String(req.headers['x-forwarded-host']||req.headers.host||'localhost:3000').split(',')[0].trim();
    const proto=String(req.headers['x-forwarded-proto']||(host.startsWith('localhost')||host.startsWith('192.168.')?'http':'https')).split(',')[0].trim();
    const target=`${proto}://${host}/play.html?room=${code}`;
    const qr=new QRCode(-1,QRErrorCorrectLevel.M);qr.addData(target);qr.make();
    const n=qr.getModuleCount(),pad=2,dim=n+2*pad;let runs='';
    for(let y=0;y<n;y++){
      for(let x=0;x<n;){if(!qr.isDark(y,x)){x++;continue;}let j=x+1;while(j<n&&qr.isDark(y,j))j++;runs+=`M${x+pad},${y+pad}h${j-x}v1h-${j-x}z`;x=j;}
    }
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="450" height="450" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${runs}" fill="#0c1231"/></svg>`;
    res.statusCode=200;res.setHeader('Content-Type','image/svg+xml; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(svg);
  }catch(e){res.statusCode=500;res.end('Ошибка QR: '+e.message);}
}
