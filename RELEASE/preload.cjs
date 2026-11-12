// window.nativeBridge of the web app: what it can't do from the browser (see src/utils/nativeBridge.ts).
// Each call goes to main.cjs, which does it with Node
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nativeBridge', {
    getDevices: () => ipcRenderer.invoke('native-bridge:get-devices'),
    syncStart: id => ipcRenderer.invoke('native-bridge:sync-start', id),
    syncStop: () => ipcRenderer.invoke('native-bridge:sync-stop'),
    syncPeers: () => ipcRenderer.invoke('native-bridge:sync-peers'),
    syncInbox: () => ipcRenderer.invoke('native-bridge:sync-inbox'),
    syncHold: (to, body) => ipcRenderer.invoke('native-bridge:sync-hold', to, body),
    syncPost: (url, body) => ipcRenderer.invoke('native-bridge:sync-post', url, body),
});
