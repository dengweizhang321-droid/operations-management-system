import hashlib
import json
from pathlib import Path
import subprocess
import winreg
from native_control_import import entry

distribution='Codex-AI-Batch2-20261108'
roots=[]
with winreg.OpenKey(winreg.HKEY_CURRENT_USER,r'Software\Microsoft\Windows\CurrentVersion\Lxss') as parent:
    for i in range(winreg.QueryInfoKey(parent)[0]):
        with winreg.OpenKey(parent,winreg.EnumKey(parent,i)) as child:
            if winreg.QueryValueEx(child,'DistributionName')[0]==distribution:
                roots.append(str(Path(winreg.QueryValueEx(child,'BasePath')[0]).resolve()))
assert roots==[str(Path('D:/codex-isolated/ai-repair-batch2-20261108-wsl').resolve())]
code=r'''
import hashlib,json,os,subprocess
from pathlib import Path
assert os.environ['WSL_DISTRO_NAME']=='Codex-AI-Batch2-20261108'
env=['HOME=/home/teruisi-pandas','PATH=/usr/bin:/bin','XDG_RUNTIME_DIR=/run/user/1000','DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus']
def user(args):return subprocess.check_output(['/usr/sbin/runuser','-u','teruisi-pandas','--','/usr/bin/env','-i',*env,*args],timeout=20).decode().strip()
units=['teruisi-pandas-w6r-'+s+'.service' for s in ('happy','intent','reload','windows-seam')]
states={u:dict(s.split('=',1) for s in user(['/usr/bin/systemctl','--user','show',u,'-p','MainPID','-p','ActiveState','-p','SubState']).splitlines()) for u in units}
assert all(s['MainPID']=='0' and s['ActiveState']=='inactive' for s in states.values())
files={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in Path('/opt/teruisi-pandas-w6r-fixture').glob('*/rotation/**/*') if p.is_file()}
listeners=subprocess.check_output(['/usr/bin/ss','-H','-ltn']).decode()
assert not any(':'+str(p)+' ' in listeners for p in [28121,28123])
print(json.dumps({'units':states,'oldIntentFiles':files,'portsFree':True,'docker':user(['/usr/bin/systemctl','--user','show','docker.service','-p','MainPID','-p','ActiveState'])}))
'''
result=subprocess.run(['wsl.exe','-d',distribution,'-u','root','--exec','/usr/bin/python3','-B','-c',code],env=entry.environment(),capture_output=True,timeout=60)
(entry.EVIDENCE/'wsl-inspect.stderr.log').write_bytes(result.stderr)
assert result.returncode==0,result.stderr[-1200:]
value=json.loads(result.stdout)
old=json.loads(Path('D:/codex-artifacts/ai-repair-integration-20261108/WSL-BEFORE.json').read_text())
assert value['oldIntentFiles']==old['oldIntentFiles'] and value['units']==old['units']
value.update(distribution=distribution,registryRoot=roots[0],oldFilesUnchanged=True,oldUnitsUnchanged=True)
(entry.EVIDENCE/'WSL-BEFORE.json').write_text(json.dumps(value,indent=2)+'\n')
print(json.dumps({'oldFiles':len(value['oldIntentFiles']),'unchanged':True,'docker':value['docker'],'portsFree':True}))
