'use strict';
// Hold the SDK cache while a transaction is evaluated, including its first retry.
exports.transact=async function(ref,update) {
  let listener;
  try {
    await new Promise((resolve,reject)=>{listener=s=>resolve(s);ref.on('value',listener,reject);});
    return await ref.transaction(update,undefined,false);
  } finally {if(listener)ref.off('value',listener);}
};
