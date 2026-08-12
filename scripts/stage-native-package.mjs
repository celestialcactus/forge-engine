import { stageNativePackage } from './native-package.mjs';

const staged = await stageNativePackage(process.argv[2]);
console.log(JSON.stringify(staged));
