#!/usr/bin/env python3
"""HELIOS deployment operator. Cloud-changing commands default to dry-run."""
import argparse
import json
import re
import shlex
import shutil
import string
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]

def validate_config(c):
    c=dict(c)
    patterns={
        'project':r'[a-z][a-z0-9-]{4,28}[a-z0-9]', 'region':r'[a-z]+-[a-z]+[0-9]',
        'service':r'[a-z][a-z0-9-]{0,47}[a-z0-9]|[a-z]', 'repository':r'[a-z][a-z0-9-]{0,61}[a-z0-9]|[a-z]',
        'bucket':r'[a-z0-9][a-z0-9-]{1,61}[a-z0-9]', 'runtime_service_account':r'[a-z][a-z0-9-]{4,28}[a-z0-9]',
        'tag':r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}', 'public_maps_key':r'[A-Za-z0-9_-]{20,100}',
        'web_model':r'[A-Za-z0-9._/-]+', 'engine_model':r'[A-Za-z0-9._/-]+',
        'maps_secret':r'[A-Za-z0-9_-]+','solar_secret':r'[A-Za-z0-9_-]+','gemini_secret':r'[A-Za-z0-9_-]+','llm_secret':r'[A-Za-z0-9_-]+',
        'secret_version':r'[1-9][0-9]*|latest',
    }
    c.setdefault('build_service_account',c.get('service','helios')+'-build')
    patterns['build_service_account']=patterns['runtime_service_account']
    for key,pattern in patterns.items():
        value=c.get(key)
        if not isinstance(value,str) or 'REPLACE' in value or not re.fullmatch(pattern,value):raise ValueError('Set a valid '+key+' in deploy/config.json (no placeholders).')
    return c

def render(c):
    image=f"{c['region']}-docker.pkg.dev/{c['project']}/{c['repository']}"
    mapping={k.upper():v for k,v in c.items()}
    mapping.update(RUNTIME_ACCOUNT=f"{c['runtime_service_account']}@{c['project']}.iam.gserviceaccount.com",WEB_IMAGE=f"{image}/web:{c['tag']}",ENGINE_IMAGE=f"{image}/engine:{c['tag']}")
    return string.Template((ROOT/'deploy/service.template.yaml').read_text()).substitute(mapping)

class Commands:
    def __init__(self,execute):self.execute=execute
    def run(self,args,**kwargs):
        shown=[re.sub(r'(_MAPS_KEY=)[^,]*',r'\1<browser-key>',str(a)) for a in args]
        print(('RUN ' if self.execute else 'DRY RUN ')+shlex.join(shown),flush=True)
        if self.execute:return subprocess.run(args,cwd=ROOT,check=True,**kwargs)
    def json(self,args):
        if not self.execute:return []
        result=subprocess.run(args+['--format=json'],cwd=ROOT,check=True,text=True,capture_output=True)
        return json.loads(result.stdout or '[]')

def setup(c,r):
    project=c['project'];p=['--project',project];region=c['region']
    r.run(['gcloud','services','enable','run.googleapis.com','cloudbuild.googleapis.com','artifactregistry.googleapis.com','secretmanager.googleapis.com','storage.googleapis.com','iap.googleapis.com',*p])
    repos=r.json(['gcloud','artifacts','repositories','list','--location',region,*p])
    if not any(x['name'].split('/')[-1]==c['repository'] for x in repos):r.run(['gcloud','artifacts','repositories','create',c['repository'],'--repository-format=docker','--location',region,*p])
    accounts=r.json(['gcloud','iam','service-accounts','list',*p])
    for name in [c['runtime_service_account'],c['build_service_account']]:
        if not any(x['email']==f'{name}@{project}.iam.gserviceaccount.com' for x in accounts):r.run(['gcloud','iam','service-accounts','create',name,*p])
    buckets=r.json(['gcloud','storage','buckets','list',*p])
    if not any(x.get('name','').removeprefix('gs://').rstrip('/')==c['bucket'] for x in buckets):r.run(['gcloud','storage','buckets','create',f"gs://{c['bucket']}",'--location',region,'--uniform-bucket-level-access','--public-access-prevention',*p])
    runtime=f"serviceAccount:{c['runtime_service_account']}@{project}.iam.gserviceaccount.com"
    builder=f"serviceAccount:{c['build_service_account']}@{project}.iam.gserviceaccount.com"
    r.run(['gcloud','storage','buckets','add-iam-policy-binding',f"gs://{c['bucket']}",'--member',runtime,'--role','roles/storage.objectUser',*p])
    r.run(['gcloud','artifacts','repositories','add-iam-policy-binding',c['repository'],'--location',region,'--member',builder,'--role','roles/artifactregistry.writer',*p])
    # Build reads Cloud Build's source archive; it receives no runtime API secrets.
    for role in ['roles/logging.logWriter','roles/storage.objectViewer']:
        r.run(['gcloud','projects','add-iam-policy-binding',project,'--member',builder,'--role',role,'--condition=None'])
    secrets=r.json(['gcloud','secrets','list',*p])
    for name in sorted({c[k] for k in ['maps_secret','solar_secret','gemini_secret','llm_secret']}):
        if not any(x['name'].split('/')[-1]==name for x in secrets):r.run(['gcloud','secrets','create',name,'--replication-policy=automatic',*p])
        r.run(['gcloud','secrets','add-iam-policy-binding',name,'--member',runtime,'--role','roles/secretmanager.secretAccessor',*p])
    print('Next: add secret VALUES in Secret Manager Console, and grant your deploy operator permission to act as the build/runtime service accounts. Never put secret values in config.json.')

def policy_files(directory):
    files=sorted(directory.glob('*.json'))
    if not files:raise ValueError('No policy-page JSON files found in the specified directory.')
    for file in files:
        if not re.fullmatch(r'[a-z0-9_]+\.json',file.name):raise ValueError('Invalid policy filename: '+file.name)
        d=json.loads(file.read_text())
        if not isinstance(d.get('title'),str) or not isinstance(d.get('pages'),list) or not d['pages']:raise ValueError('Invalid policy document: '+file.name)
        for page in d['pages']:
            if not isinstance(page.get('page'),int) or page['page']<1 or not isinstance(page.get('text'),str):raise ValueError('Invalid policy page: '+file.name)
    return files

def deploy(c,r):
    p=['--project',c['project']];location=['--region',c['region'],*p]
    services=r.json(['gcloud','run','services','list',*location])
    if any((x.get('metadata',{}).get('name') or x.get('name','').split('/')[-1])==c['service'] for x in services):
        policy=r.json(['gcloud','run','services','get-iam-policy',c['service'],*location])
        if any(m in ['allUsers','allAuthenticatedUsers'] for b in policy.get('bindings',[]) for m in b.get('members',[])):raise ValueError('Existing service has public IAM access. Remove its public binding before using this private-preview deployment.')
    for secret in sorted({c[k] for k in ['maps_secret','solar_secret','gemini_secret','llm_secret']}):
        version=r.json(['gcloud','secrets','versions','describe',c['secret_version'],'--secret',secret,*p])
        if r.execute and version.get('state')!='ENABLED':raise ValueError('Secret version is not enabled: '+secret)
    with tempfile.NamedTemporaryFile(mode='w',suffix='.yaml') as file:
        file.write(render(c));file.flush()
        r.run(['gcloud','run','services','replace',file.name,*location])
    r.run(['gcloud','run','services','update',c['service'],'--iap',*location])
    number=r.json(['gcloud','projects','describe',c['project']])
    number=number.get('projectNumber','PROJECT_NUMBER') if isinstance(number,dict) else 'PROJECT_NUMBER'
    r.run(['gcloud','run','services','add-iam-policy-binding',c['service'],'--member',f'serviceAccount:service-{number}@gcp-sa-iap.iam.gserviceaccount.com','--role','roles/run.invoker',*location])
    print(('Private service deployed. ' if r.execute else 'Planned private deployment. ')+ 'In Cloud Run Security / IAP, complete initial OAuth setup if requested and grant access to the intended test users. No anonymous access was granted.')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['check','render','setup','build','deploy','seed','upload-policies'])
    parser.add_argument('--config',type=Path,default=ROOT/'deploy/config.json')
    parser.add_argument('--execute',action='store_true',help='Perform cloud operations; otherwise only print the plan')
    parser.add_argument('--directory',type=Path);parser.add_argument('--output',type=Path)
    args=parser.parse_args();c=validate_config(json.loads(args.config.read_text()));r=Commands(args.execute)
    if args.execute and not shutil.which('gcloud'):raise ValueError('Install Google Cloud CLI and run gcloud auth login first.')
    if args.command=='check':
        for name in ['web/Dockerfile','engine/Dockerfile','cloudbuild.yaml','.gcloudignore','.dockerignore','engine/data/catalog/datagovsg_datasets.csv','engine/data/catalog/singstat_tables.csv','web/data/assumptions/calibrated']:
            if not (ROOT/name).exists():raise ValueError('Missing deployment input: '+name)
        print('Local configuration and deployment inputs OK. No cloud credentials, billing, quotas or secret values were checked.')
        if not (ROOT/'policy_sources/pages').exists():print('Policy sources are absent locally; use upload-policies with authorised JSON extracts to enable document drafting.')
    elif args.command=='render':
        text=render(c)
        if args.output:args.output.write_text(text)
        else:print(text)
    elif args.command=='setup':setup(c,r)
    elif args.command=='build':
        sub=','.join(f'{k}={v}' for k,v in {'_REGION':c['region'],'_REPOSITORY':c['repository'],'_TAG':c['tag'],'_MAPS_KEY':c['public_maps_key'],'_BUILD_ACCOUNT':c['build_service_account']}.items())
        r.run(['gcloud','builds','submit','.','--config','cloudbuild.yaml','--project',c['project'],'--substitutions',sub])
    elif args.command=='deploy':deploy(c,r)
    elif args.command=='seed':
        files=[(ROOT/'web/data/compliance/drafts.json','rules/drafts.json')]
        files += [(f,'rules/candidates/'+f.name) for f in (ROOT/'web/data/compliance/rules/candidates').glob('*.json')]
        files += [(f,'reports/'+str(f.relative_to(ROOT/'web/public/reports'))) for f in (ROOT/'web/public/reports').glob('*/*') if f.name in ['report.json','before.jpg','after.png','satellite.png']]
        for source,key in files:
            if source.exists():r.run(['gcloud','storage','cp',str(source),f"gs://{c['bucket']}/{key}",'--no-clobber','--if-generation-match=0','--project',c['project']])
    elif args.command=='upload-policies':
        if not args.directory:raise ValueError('Pass --directory /path/to/authorised/policy-page-json')
        for source in policy_files(args.directory):r.run(['gcloud','storage','cp',str(source),f"gs://{c['bucket']}/policy-pages/{source.name}",'--project',c['project']])
    if args.command in ['setup','build','deploy','seed','upload-policies'] and not args.execute:print('Dry run only. Add --execute when ready to perform these actions in your project.')

if __name__=='__main__':
    try:main()
    except (ValueError,FileNotFoundError,json.JSONDecodeError,subprocess.CalledProcessError) as error:
        print('Deployment preparation failed: '+str(error),file=sys.stderr);sys.exit(1)
