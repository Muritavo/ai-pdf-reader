// window.nativeBridge of the web app: what it can't do from the browser (see src/utils/nativeBridge.ts).
// Each call goes to main.cjs, which does it with Node
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nativeBridge', {
    getDevices: () => ipcRenderer.invoke('native-bridge:get-devices'),
});
