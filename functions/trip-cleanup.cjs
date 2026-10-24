'use strict';
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {getDatabase}=require('firebase-admin/database');
const {getStorage}=require('firebase-admin/storage');
const {purgeExpiredRooms}=require('./trip-cleanup-service.cjs');
exports.purgeDeletedTrips=onSchedule({schedule:'0 * * * *',timeZone:'Asia/Taipei',region:'asia-southeast1',maxInstances:1,concurrency:1,memory:'256MiB',timeoutSeconds:540,retryCount:3,minBackoffSeconds:60,maxBackoffSeconds:3600},async()=>{
  console.log('Expired trip cleanup',await purgeExpiredRooms(getDatabase(),getStorage().bucket()));
});
