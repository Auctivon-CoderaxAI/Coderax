import { spawn } from 'node:child_process';

// A supervisor killed before publishing the record closes IPC without sending
// permission to start. A recorded launcher and its service share a process group.
if (process.connected) {
  process.once('message', (message) => {
    if (message !== 'start') {
      process.disconnect();
      return;
    }
    const [file, ...args] = process.argv.slice(2);
    const service = spawn(file, args, { stdio: 'inherit' });
    service.once('error', (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
    service.once('exit', (code) => {
      process.exitCode = code ?? 1;
    });
  });
}
