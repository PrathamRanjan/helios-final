#!/usr/bin/env python3
"""Non-billable HTTP smoke tests. For IAP supply an appropriately issued token file."""
import argparse
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request,urlopen,build_opener,HTTPRedirectHandler

class NoRedirect(HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):return None

CITIES=['bengaluru','delhi-ncr','mumbai','hyderabad','chennai','kolkata','pune','ahmedabad']

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--base-url',required=True);p.add_argument('--engine-url');p.add_argument('--token-file',type=Path)
 args=p.parse_args();base=args.base_url.rstrip('/')
 parsed=urlparse(base)
 if parsed.scheme not in ['http','https'] or not parsed.netloc or parsed.username or parsed.password:raise ValueError('Provide an http(s) base URL without embedded credentials.')
 if args.token_file and parsed.scheme!='https' and parsed.hostname not in ['localhost','127.0.0.1']:raise ValueError('Do not send bearer credentials over remote plain HTTP.')
 headers={'Authorization':'Bearer '+args.token_file.read_text().strip()} if args.token_file else {}
 def get(path,expected=200):
  try:
   with build_opener(NoRedirect()).open(Request(base+path,headers=headers),timeout=60) as r:
    status=r.status;data=r.read();content_type=r.headers.get('Content-Type','')
    if r.url.split('/')[2]!=parsed.netloc:raise ValueError('Authentication redirected the smoke test; use a valid IAP token or test in the signed-in browser.')
  except HTTPError as e:status=e.code;data=e.read();content_type=''
  assert status==expected,f'{path}: expected {expected}, got {status}'
  print(f'{status} {path}')
  return data,content_type
 data,_=get('/api/health');assert json.loads(data)['ok']
 for path in ['/','/sg','/bangkok','/hanoi','/india','/api/district/jurong_east','/api/sg/areas/boundary?area=jurong_east','/api/reports/ev_jurong_east_01/report.json','/api/rules/docs']:
  get(path)
 for city in CITIES:
  get(f'/india/{city}');get(f'/india/{city}/sandbox')
 get('/india/unknown-city/sandbox',404)
 get('/api/reports/invalid/unknown.file',400)
 request=Request(base+'/api/studio/tools',headers={**headers,'Content-Type':'application/json'},data=json.dumps({'tool':'area_profile','args':{'area':'jurong_east'}}).encode())
 with build_opener(NoRedirect()).open(request,timeout=60) as r:
  assert json.load(r)['ok'],'Studio callback could not load packaged nature data'
  print('200 Studio tool and internal web callback')
 if args.engine_url:
  # Do not send the web/IAP credential to another service.
  for suffix in ['/health','/tools/datasets?q=transport&limit=2']:
   with urlopen(args.engine_url.rstrip('/')+suffix,timeout=60) as r:
    data=json.load(r);assert data;print('200 engine '+suffix)
 print('Route/data smoke checks passed. This does not exercise billable AI, real Cloud Storage or IAP permissions.')
if __name__=='__main__':main()
