'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('cachenook', {
  getState: () => ipcRenderer.invoke('app:state'),
  openFullDiskAccess: () => ipcRenderer.invoke('app:open-fda'),
  setSchedule: (options) => ipcRenderer.invoke('schedule:set', options),
  runStaleJob: (apply) => ipcRenderer.invoke('schedule:run', apply),
  showScheduleLog: () => ipcRenderer.invoke('schedule:show-log'),
  deleteSnapshots: () => ipcRenderer.invoke('deep:delete-snapshots'),
  scanInstallers: () => ipcRenderer.invoke('deep:scan-installers'),
  openTrash: () => ipcRenderer.invoke('deep:open-trash'),
  checkUpdates: (url) => ipcRenderer.invoke('update:check', url),
  openUpdate: (url) => ipcRenderer.invoke('update:open', url),
  setLoginItem: (enabled) => ipcRenderer.invoke('app:set-login', enabled),
  startScan: () => ipcRenderer.invoke('scan:start'),
  cancelScan: () => ipcRenderer.invoke('scan:cancel'),
  runClean: (ids) => ipcRenderer.invoke('clean:run', ids),
  scanProjects: () => ipcRenderer.invoke('projects:scan'),
  cancelProjects: () => ipcRenderer.invoke('projects:cancel'),
  scanFiles: () => ipcRenderer.invoke('files:scan'),
  cancelFiles: () => ipcRenderer.invoke('files:cancel'),
  trashFiles: (paths) => ipcRenderer.invoke('files:trash', paths),
  scanPersonal: () => ipcRenderer.invoke('personal:scan'),
  cancelPersonal: () => ipcRenderer.invoke('personal:cancel'),
  trashPersonal: (paths) => ipcRenderer.invoke('personal:trash', paths),
  classifyPersonal: (files) => ipcRenderer.invoke('personal:classify', files),
  cleanProjects: (paths) => ipcRenderer.invoke('projects:clean', paths),
  reveal: (target) => ipcRenderer.invoke('shell:reveal', target),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config) => ipcRenderer.invoke('config:set', config),
  onScanEvent: (callback) => subscribe('scan:event', callback),
  onCleanEvent: (callback) => subscribe('clean:event', callback),
  onProjectsEvent: (callback) => subscribe('projects:event', callback),
  onFilesEvent: (callback) => subscribe('files:event', callback),
  onOpenSettings: (callback) => subscribe('app:open-settings', callback),
  onScanNow: (callback) => subscribe('app:scan-now', callback),
  onCheckUpdates: (callback) => subscribe('app:check-updates', callback),
});
