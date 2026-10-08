import assert from "node:assert/strict";
import test from "node:test";
import { assertCustomerServiceShop, customerServiceHomeSessionEvidence, customerServiceDownloadKind, customerServiceExportCount, openCustomerServicePage } from "../tools/jd-customer-service-export";
import type { Page } from "playwright-core";
import { jdCustomerServiceWorkflow as contract } from "../lib/jd/customer-service-workflow";

function identityPage(input: { missing?: boolean; remainsMissing?: boolean; wrongTitle?: boolean; challenge?: boolean; wrongUrl?: boolean; missingTab?: boolean } = {}) {
  let reloads = 0;
  const visible = () => !input.missing || (reloads > 0 && !input.remainsMissing);
  const header = {
    filter() { return this; },
    async waitFor() { if (!visible()) throw new Error("missing account widget"); },
    async count() { return visible() ? 1 : 0; },
    async getAttribute() { return input.wrongTitle ? "another shop" : contract.shopName; },
    async innerText() { return contract.shopName; },
  };
  const page = {
    url: () => input.wrongUrl ? "https://passport.shop.jd.com/login" : contract.entryUrl,
    locator: (selector: string) => { assert.equal(selector, ".shop-menu-accountV1__right-account-top-name"); return header; },
    frames: () => [{ evaluate: async () => ({ challengePresent: !!input.challenge, credentialRejected: false, temporarilyLocked: false }) }],
    getByRole: () => ({ count: async () => input.missingTab ? 0 : 1 }),
    reload: async () => { reloads++; },
  } as unknown as Page;
  return { page, reloads: () => reloads };
}

test("客服身份只从唯一页头核验，正文同名不能代替身份", async () => {
  const current = identityPage();
  assert.deepEqual(await assertCustomerServiceShop(current.page), { reloaded: false });
  const wrong = identityPage({ wrongTitle: true });
  await assert.rejects(assertCustomerServiceShop(wrong.page, true), /IDENTITY_MISMATCH/);
  assert.equal(wrong.reloads(), 0);
});

test("先从京麦首页确认原会话，再打开聊天记录，认证失败不能继续", async () => {
  for (const fail of [false, true]) {
    const current = identityPage();
    const events: string[] = [];
    let url = "about:blank";
    const page = Object.assign(current.page, {
      goto: async (target: string) => { events.push(target); url = target; },
      url: () => url,
    });
    const authenticate = async () => { events.push("authenticate"); if (fail) throw new Error("LOGIN_GATE"); };
    if (fail) {
      await assert.rejects(openCustomerServicePage(page, authenticate), /LOGIN_GATE/);
      assert.deepEqual(events, ["https://shop.jd.com/", "authenticate"]);
    } else {
      assert.deepEqual(await openCustomerServicePage(page, authenticate), { reloaded: false });
      assert.deepEqual(events, ["https://shop.jd.com/", "authenticate", contract.entryUrl]);
    }
  }
});

test("初始空页头只允许无登录异常且控件齐全时刷新一次", async () => {
  const delayed = identityPage({ missing: true });
  assert.deepEqual(await assertCustomerServiceShop(delayed.page, true), { reloaded: true });
  assert.equal(delayed.reloads(), 1);
  const missing = identityPage({ missing: true, remainsMissing: true });
  await assert.rejects(assertCustomerServiceShop(missing.page, true), /IDENTITY_MISMATCH/);
  assert.equal(missing.reloads(), 1);
});

test("导出阶段、验证关卡、错误路径或缺业务控件均不能刷新恢复", async () => {
  const later = identityPage({ missing: true });
  await assert.rejects(assertCustomerServiceShop(later.page), /IDENTITY_MISMATCH/);
  assert.equal(later.reloads(), 0);
  for (const input of [{ missing: true, challenge: true }, { missing: true, wrongUrl: true }, { missing: true, missingTab: true }]) {
    const blocked = identityPage(input);
    await assert.rejects(assertCustomerServiceShop(blocked.page, true));
    assert.equal(blocked.reloads(), 0);
  }
});
test("导出确认要求唯一正整数行数", () => {
  assert.equal(customerServiceExportCount("导出数据共计6998条，是否确认导出？"), 6998);
  for (const value of ["导出数据共计0条，是否确认导出？", "导出数据共计100001条，是否确认导出？", "确认导出全部？"])
    assert.throws(() => customerServiceExportCount(value), /EXPORT_COUNT_INVALID/);
});
test("下载链接精确限定京东源、路径和视图文件类型", () => {
  assert.equal(customerServiceDownloadKind("https://storage.jd.com/im-data-web.common/fixture.xlsx?Expires=1", "list"), ".xlsx");
  assert.equal(customerServiceDownloadKind("https://storage.jd.com/im-data-web.chatlog/fixture.log", "messages"), ".log");
  assert.equal(customerServiceDownloadKind("//storage.jd.com/im-data-web.chatlog/fixture.log", "messages"), ".log");
  assert.throws(() => customerServiceDownloadKind("/im-data-web.chatlog/fixture.log", "messages"), /DOWNLOAD_LINK_INVALID/);
  assert.throws(() => customerServiceDownloadKind("//storage.jd.com.invalid/im-data-web.chatlog/fixture.log", "messages"), /DOWNLOAD_LINK_INVALID/);
  assert.throws(() => customerServiceDownloadKind("https://storage.jd.com/im-data-web.common/fixture.log", "messages"), /DOWNLOAD_LINK_INVALID/);
  assert.throws(() => customerServiceDownloadKind("https://storage.jd.com/im-data-web.chatlog/fixture.xlsx", "list"), /DOWNLOAD_LINK_INVALID/);
  for (const url of [
    "http://storage.jd.com/im-data-web.common/fixture.xlsx",
    "https://storage.jd.com.attacker.invalid/im-data-web.common/fixture.xlsx",
    "https://user@storage.jd.com/im-data-web.common/fixture.xlsx",
    "https://storage.jd.com/im-data-web.common/fixture.log",
    "https://storage.jd.com/another-prefix/fixture.xlsx",
    "https://storage.jd.com:8443/im-data-web.common/fixture.xlsx",
  ]) assert.throws(() => customerServiceDownloadKind(url, "list"), /DOWNLOAD_LINK_INVALID/);
});

function dashboard(input: {wrong?: boolean; title?: boolean; challenge?: boolean; password?: boolean; hidden?: boolean; missing?: string; loginFrame?: boolean} = {}) {
  let current = "https://shop.jd.com/jdm/home";
  const header={filter(){return this;},waitFor:async()=>{if(input.hidden)throw Error("hidden");},count:async()=>input.hidden?0:1,getAttribute:async()=>input.title?"wrong":contract.shopName,innerText:async()=>input.wrong?"wrong":contract.shopName};
  const frame={url:()=>current,locator:(selector:string)=>({innerText:async()=>"short authenticated dashboard",count:async()=>input.password?1:0,filter(){return this;}}),evaluate:async()=>({challengePresent:!!input.challenge,credentialRejected:false,temporarilyLocked:false})};
  const login={...frame,url:()=>"https://passport.shop.jd.com/login",locator:()=>({innerText:async()=>"账号密码登录",count:async()=>1,filter(){return this;}})};
  const page={url:()=>current,goto:async(url:string)=>{current=url==="https://shop.jd.com/"?"https://shop.jd.com/jdm/home":url;},frames:()=>input.loginFrame?[frame,login]:[frame],mainFrame:()=>frame,locator:()=>header,getByText:(label:string)=>({filter(){return this;},count:async()=>input.missing===label?0:1})} as unknown as Page;
  return page;
}
test("客服主页短导航须精确店铺/title和四个可见业务控件，不能靠URL或菜单词单独认证",async()=>{
  assert.equal(await customerServiceHomeSessionEvidence(dashboard(),contract.storeKey),true);
  for(const input of [{wrong:true},{title:true},{challenge:true},{password:true},{hidden:true},{missing:"待办"},{loginFrame:true}]) assert.equal(await customerServiceHomeSessionEvidence(dashboard(input),contract.storeKey),false);
});
test("仅泛用识别器pending允许同店完整业务证据，显式登录/凭据失败不恢复",async()=>{
  const page=dashboard();
  assert.deepEqual(await openCustomerServicePage(page,async()=>{throw Error("waiting_login：登录状态在有界等待后仍无法确认，需要人工检查");}),{reloaded:false});
  for(const reason of ["LOGIN_GATE","验证码或安全验证","本机加密凭据未被平台接受"]){const p=dashboard();await assert.rejects(openCustomerServicePage(p,async()=>{throw Error(reason);}),new RegExp(reason));assert.equal(p.url(),"https://shop.jd.com/jdm/home");}
});
