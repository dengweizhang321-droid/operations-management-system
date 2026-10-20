# PiBusiness / PiNative ACL 濂戠害闂ㄧ锛圥0-1锛?
- 鏃ユ湡锛?026-10-20锛圓sia/Shanghai锛?- 鍒嗘敮锛歚codex/schema-acl-gate-20261020`
- 鍩虹嚎锛歚9637fa692fa93d2b134cbecb689a6b15a119c7ac`锛堝惈 P0-3 鍛ㄦ姤绉熺害銆丳0-2/P0-5 浼樺寲锛?- 鐘舵€侊細婧愮爜鍊欓€夛紱鏈墽琛岀敓浜ч儴缃层€佽縼绉汇€佹湇鍔″惎鍋滄垨鎺у埗鍖呴噰鐢ㄣ€?
## 鐩爣

2026-10-20 缁勫悎鍙戝竷鍦?Finalize 鎵嶅彂鐜?Pi152 鐨?ACL 鐩綍鏈熸湜鎶?append-only 鐨?intents/audits 涔熻姹?UPDATE锛岄€犳垚绾?33.7 鍒嗛挓杩斿伐銆傛湰浠诲姟鎶婇潤鎬?ACL 濂戠害妫€鏌ユ斁鍒版湁闄愮粨鏋勫噯澶囦箣鍓嶏紝骞惰鐩?main 鏂板鐨?PiNative 153銆?
## 鏀瑰姩

| 鏂囦欢 | 鍐呭 |
| --- | --- |
| `tools/main-schema-release.mjs` | 鏂板 `schemaAclContractScripts` 鍜?`runSchemaAclContract`锛沗prepareMainSchemaRelease` 涓?`verifyMainSchemaRelease` 鍦ㄨ皟鐢?binder 涔嬪墠杩愯瀵瑰簲闈欐€佹鏌ャ€侾iBusiness 鐢?`tests/pi152-acl-catalog-boundary.py`锛孭iNative 鐢?`tests/pi153-acl-catalog-boundary.py`锛涢潪 Pi 缁撴瀯涓嶈繍琛屻€傛鏌ュけ璐ュ湪鍐?`PREPARED.json` 涔嬪墠鎶涘嚭銆?|
| `tests/pi153-acl-catalog-boundary.py` | 鏂板 PiNative 153 闈欐€佸绾︽鏌ワ細7 寮?native 琛ㄣ€? 寮?append-only銆佹湁搴?TABLES銆乣ai_pi_business_delegations` 鐨?native 褰掑睘锛?3 椤规鍙嶄緥锛屼笉杩炴暟鎹簱銆佷笉瀵煎叆 Django銆?|
| `tests/pi152-acl-catalog-boundary.py` | 娌跨敤骞朵繚鐣欐湁搴?TABLES 涓?`permissions=False` 璐熶緥锛?7 椤规鏌ャ€?|
| `tests/schema-acl-contract-gate.test.mjs` | 鏂板闂ㄧ鍗曞厓娴嬭瘯锛氶€夋嫨姝ｇ‘鑴氭湰銆佸け璐ヤ俊鎭€侀潪 Pi 鐭矾锛涘苟鍦ㄥ綋鍓嶆簮鐮佷笂瀹為檯璺戦€?152/153 涓や釜闈欐€佽剼鏈€?|
| `docs/pi-native-capabilities-20261020/mandatory-code-checks.json` | 閲嶆柊缁戝畾 `codeSha256` 涓哄綋鍓?PiNative `CODE_FILES` 鎽樿 `f4223f0efd02...`锛涙洿鏂?`checkedAt`銆傛棫鍊间繚鐣欏湪 Git 鍘嗗彶锛屾湭鏀瑰啓鍘嗗彶鎶ュ憡銆?|
| `config/main-schema-releases/ai-0087.json` | 鍚屾 `codeSha256` 鍜?`validationSha256`锛坄e810b6d0...`锛夈€?|

## 楠岃瘉

- `node --test tests/main-schema-pi-release.test.mjs tests/main-schema-release.test.mjs tests/schema-acl-contract-gate.test.mjs`锛? 椤归€氳繃銆?- `node --test tests/publish-prepared-main.test.mjs tests/publish-latest-main.test.mjs tests/publish-main-command.test.mjs`锛?2 椤归€氳繃銆?- `python tests/pi152-acl-catalog-boundary.py`锛?7 椤归€氳繃锛沗python tests/pi153-acl-catalog-boundary.py`锛?3 椤归€氳繃銆?- `pi_native_candidate.candidate(...)` 鍦ㄥ綋鍓嶆簮鐮佷笂杩斿洖 `bound`锛宍codeSha256=3dc78ede...`銆乣migrationSha256=a08ccd88...`銆?- `node --check tools/main-schema-release.mjs`銆乣python -m py_compile`銆乣git diff --check` 閫氳繃銆?- 鏈満鍙湁 PowerShell 5.1锛屾湭杩愯 PS7锛涙湰浠诲姟鏈敼 PowerShell 鐢熶骇鑴氭湰銆?
## 璇佹嵁涓庤竟鐣?
- PiNative 鐨?`codeSha256` 鍙樺寲鏉ヨ嚜 `main-schema-release.mjs`锛堝湪 PiNative `CODE_FILES` 鍐咃級锛涘凡閽堝鍙樻洿鍔犺窇 Node 璇硶涓庝袱涓?ACL 鑴氭湰锛岃縼绉诲拰 PowerShell/Python 婧愭湭鍙橈紝鍥涗釜鍘熸鏌ョ被鍒繚鎸佸師璁板綍銆傛湭鎶婃湰娆￠棬绂佹祴璇曞啓杩?`mandatory-code-checks` 鐨?`checks` 鏁扮粍锛岄伩鍏嶆敼鍙?PiNative 璇佹嵁 schema銆?- `main-prebuild-queue` 涓殑鍘嗗彶鍥哄畾 bundle pin 鏈敼锛涙柊鐨勬帶鍒跺寘鍑嗗/閲囩敤闇€瑕佸崟鐙巿鏉冦€傛簮鐮侀棬绂佸湪鍊欓€?source 鐨?publisher 璺緞鐢熸晥锛屼笉渚濊禆宸插畨瑁呮帶鍒跺寘銆?- 鏈墽琛岀敓浜ч儴缃层€佽縼绉汇€佹湇鍔″惎鍋溿€佸懆鎶ュ彂閫佹垨鎺у埗鍖?`--adopt`锛涘姛鑳戒笌涓氬姟楠屾敹浠嶇敱鐢ㄦ埛璐熻矗銆?- 鍚堝苟鍒?`main` 鍓嶄粛寤鸿鐙珛 `critical-review`锛岄噸鐐规牳瀵归棬绂佷綅缃€丳iNative 璇佹嵁閲嶇粦鍜屾帶鍒跺寘 pin 鐨勫奖鍝嶃€?