'use strict';

const path = require('path');
const Base = require('sdk-base');
const cp = require('child_process');

class Helper extends Base {
  constructor() {
    super();
    this.childs = [];
  }

  * fork(module, args) {
    const child = cp.fork(path.join(__dirname, `${module}.js`), args);
    this.childs.push(child);

    child.on('message', msg => {
      this.emit(`${module}_${msg}`);
    });
    yield this.await(`${module}_ready`);
  }

  * stop() {
    for (const child of this.childs) {
      child.removeAllListeners();
      child.kill();
    }
  }
}

module.exports = new Helper();
