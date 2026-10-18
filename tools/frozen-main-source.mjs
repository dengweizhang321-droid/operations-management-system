/** A publication is bound to its approved commit, never a movable remote ref. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

export async function assertFrozenSource({source,mainCommit,sourceTree},{git=async(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true}).trim()}={}){
 assert.match(mainCommit??'',/^[a-f0-9]{40}$/,'发布目标必须是冻结的完整提交');
 const commit=await git(source,['rev-parse','HEAD']);
 assert.equal(commit,mainCommit,'冻结的main来源已变化');
 const tree=await git(source,['rev-parse','HEAD^{tree}']);
 assert.equal(tree,await git(source,['rev-parse',mainCommit+'^{tree}']),'冻结源码tree不属于批准提交');
 if(sourceTree!==undefined)assert.equal(tree,sourceTree,'冻结源码tree已变化');
 assert.equal(await git(source,['status','--porcelain']),'','发布来源有未提交修改');
 return {commit,tree};
}
