import { app, getFunctions, httpsCallable } from '../firebase.js?v=20261023-travel1';
const callable = httpsCallable(getFunctions(app,'asia-southeast1'),'roomApi',{timeout:60000});
export async function roomRequest(data) { return (await callable(data)).data; }
