'use strict';

const co = require('co');
const URL = require('./url');
const is = require('is-type-of');
const assert = require('assert');
const Base = require('sdk-base');
const utility = require('utility');
const Constants = require('./const');
const protocol = require('dubbo-remoting');
const Connection = require('./client_conn');
const LocalCache = require('./local_cache');

const localIp = require('address').ip();
const defaultObject = {
  protocol,
  username: null,
  password: null,
  defaultPort: 9090,
  retryPeriod: 5000,
  timeout: 10000,
  logger: console,
};
const sleep = timeout => cb => { setTimeout(cb, timeout); };

class RegistryClient extends Base {
  /**
   * Constructs the object.
   *
   * @param {Object} options
   *   - {String} address - 注册中心地址
   *   - {String} [defaultPort] - 注册中心缺省端口
   *   - {String} [username] - 注册中心登录用户名
   *   - {String} [password] - 注册中心登录密码
   *   - {Protocol} protocol - 注册中心协议
   *   - {String} appName - 应用名
   *   - {Logger} logger - 日志对象
   * @constructor
   */
  constructor(options) {
    assert(options && options.address, '[dubbo-registry] options.address is required');
    super(Object.assign({ initMethod: 'init' }, defaultObject, options));

    this._conn = null;
    this._login = false;
    this._running = true;
    this._reconnecting = false;
    this._registryVersion = null; // 注册中心Dubbo版本
    this._syncRegistries = [];
    const addresses = options.address.split(',');
    this._configRegistries = addresses.map(addr => this._normalizeAddr(addr));
    if (this.options.localCacheDir) {
      this._localCache = new LocalCache({ localCacheDir: this.options.localCacheDir });
      this._localCache.on('error', err => { this._error(err); });
      this._subscribed = this._localCache.loadAll(); // key => { url, value }
    } else {
      this._localCache = null;
      this._subscribed = new Map();
    }
    this._published = new Map(); // key => url

    this.on('conn_close', this._reconnect.bind(this));
  }

  get logger() {
    return this.options.logger;
  }

  get isOldRegistry() {
    return !this._registryVersion;
  }

  get commonParamters() {
    return {
      application: this.options.appName,
      dubbo: Constants.DUBBO_VERSION,
      check: false,
      pid: process.pid,
      protocol: 'dubbo',
      revision: '1.0.0',
      timestamp: Date.now(),
    };
  }

  * init() {
    yield this._connect();
  }

  * close() {
    this._login = false;
    this._running = false;
    this._reconnecting = false;
    if (this._conn) {
      this._conn.close();
    }
    this.removeAllListeners();
  }

  /**
   * 订阅
   *
   * @param {Object} info
   *   - {String} interfaceName - the interface name
   *   - {String} version - the version
   *   - {String} group - the group
   * @param {Function} listener  The listener
   * @return {void}
   */
  subscribe(info, listener) {
    assert(info && info.interfaceName, '[dubbo-registry] subscribe(info, listener) info.interfaceName is required');
    assert(info.version, '[dubbo-registry] subscribe(info, listener) info.version is required');
    assert(is.function(listener), '[dubbo-registry] subscribe(info, listener) listener is required');

    const url = new URL({
      protocol: 'consumer',
      host: localIp,
      path: info.group ? `${info.group}/${info.interfaceName}` : info.interfaceName,
      parameters: Object.assign(this.commonParamters, {
        category: 'providers,configurators,routers',
        methods: '*',
        side: 'consumer',
        interface: info.interfaceName,
        version: info.version,
        group: info.group,
      }),
    });
    this.on(url.serviceKey, listener);

    const cache = this._subscribed.get(url.serviceKey);
    if (cache) {
      if (utility.has(cache, 'value')) {
        process.nextTick(() => { listener(cache.value); });
      }
    } else {
      this._subscribed.set(url.serviceKey, { url });
      if (this._login) {
        co(function* () {
          yield this._callFn('_doSubscribe', url);
        }.bind(this)).catch(err => { this._error(err); });
      }
    }
  }

  unSubscribe(info, listener) {
    assert(info && info.interfaceName, '[dubbo-registry] unSubscribe(info, listener) info.interfaceName is required');
    assert(info.version, '[dubbo-registry] unSubscribe(info, listener) info.version is required');

    const url = new URL({
      protocol: 'consumer',
      host: localIp,
      path: info.group ? `${info.group}/${info.interfaceName}` : info.interfaceName,
      parameters: Object.assign(this.commonParamters, {
        category: 'providers,configurators,routers',
        methods: '*',
        side: 'consumer',
        interface: info.interfaceName,
        version: info.version,
        group: info.group,
      }),
    });
    if (is.function(listener)) {
      this.removeListener(url.serviceKey, listener);
    } else {
      this.removeAllListeners(url.serviceKey);
    }
    if (!this.listeners(url.serviceKey).length) {
      this._subscribed.delete(url.serviceKey);
      if (this._login) {
        co(function* () {
          yield this._callFn('_doUnSubscribe', url);
        }.bind(this)).catch(err => { this._error(err); });
      }
    }
  }

  /**
   * 发布
   *
   * @param {Object} info
   *   - {String} interfaceName - the interface name
   *   - {String} version - the version
   *   - {String} group - the group
   *   - {String} url - export url
   * @return {void}
   */
  publish(info) {
    assert(info && info.interfaceName, '[dubbo-registry] publish(info) info.interfaceName is required');
    assert(info.version, '[dubbo-registry] publish(info) info.version is required');
    assert(info.url, '[dubbo-registry] publish(info) info.url is required');

    // @example:
    // dubbo://127.0.0.1:12200/com.gxc.demo.DemoService?anyhost=true&application=xxx&codec=hsf&dubbo=2.5.3&interface=com.gxc.demo.DemoService&methods=sayHello&pid=41982&revision=1.0.0&side=provider&threads=200&timestamp=1487580276186&version=1.0.0
    const url = URL.valueOf(info.url);
    if (!url.path) {
      url.path = info.group ? `${info.group}/${info.interfaceName}` : info.interfaceName;
    }
    url.parameters = Object.assign(this.commonParamters, {
      anyhost: true,
      codec: 'dubbo',
      methods: '*',
      side: 'provider',
      threads: 200,
      interface: info.interfaceName,
      version: info.version,
      group: info.group,
    }, url.parameters);

    if (!this._published.has(url.serviceKey)) {
      this._published.set(url.serviceKey, url);
      if (this._login) {
        co(function* () {
          yield this._callFn('_register', url);
        }.bind(this)).catch(err => { this._error(err); });
      }
    }
  }

  * _callFn(fnName, ...args) {
    yield this._callFnWithCount(fnName, 1, ...args);
  }

  * _callFnWithCount(fnName, count, ...args) {
    const isSuccess = yield this[fnName].call(this, ...args);
    if (!isSuccess) {
      let retryInterval = count * this.options.retryPeriod;
      if (retryInterval > 12000) {
        retryInterval = 12000;
      }
      this.logger.warn('[dubbo-registry#client] call function => %s failed at %d time(s) with args => %j, and will retry %s later',
        fnName, count, args, retryInterval);
      count += 1;
      setTimeout(() => {
        this.emit('retry_call', fnName, count, ...args);
      }, retryInterval);
    } else {
      this.logger.info('[dubbo-registry#client] call function => %s success at %d time(s) with args => %j', fnName, count, args);
    }
  }

  * _register(url) {
    return yield this._sendUrl(url, 'register');
  }

  * _unRegister(url) {
    return yield this._sendUrl(url, 'unregister');
  }

  * _doSubscribe(url) {
    // register as a consumer
    const consumerUrl = url.addParameter('category', 'consumer');
    if (!(yield this._register(consumerUrl))) {
      return false;
    }
    return yield this._sendUrl(url, 'subscribe');
  }

  * _doUnSubscribe(url) {
    const consumerUrl = url.addParameter('category', 'consumer');
    if (!(yield this._unRegister(consumerUrl))) {
      return false;
    }
    return yield this._sendUrl(url, 'unsubscribe');
  }

  * _connect() {
    const sLen = this._syncRegistries.length;
    const cLen = this._configRegistries.length;
    let offset;
    let isSuccess = false;
    if (sLen) {
      offset = utility.random(sLen);
      for (let i = 0; i < sLen; ++i) {
        const index = (offset + i) % sLen;
        const address = this._syncRegistries[index];
        isSuccess = yield this._createConnection(address);
        if (isSuccess) {
          break;
        }
      }
    }
    if (!isSuccess && cLen) {
      offset = utility.random(cLen);
      for (let i = 0; i < cLen; ++i) {
        const index = (offset + i) % cLen;
        const address = this._configRegistries[index];
        isSuccess = yield this._createConnection(address);
        if (isSuccess) {
          break;
        }
      }
    }
    if (!isSuccess) {
      const allRegistries = this._syncRegistries.concat(this._configRegistries).map(r => `\n\t- ${r.host}:${r.port}`);
      const err = new Error(`[dubbo-registry] Can not connect to registry => ${allRegistries}`);
      err.name = 'DubboRegistryConnectionError';
      throw err;
    }
  }

  * _reconnect() {
    // 防止重入
    if (this._reconnecting) {
      return;
    }
    this._reconnecting = true;
    while (this._running) {
      yield sleep(this.options.retryPeriod);
      try {
        yield this._connect();
        return;
      } catch (err) {
        this._error(err);
      }
    }
    this._reconnecting = false;
  }

  * _createConnection(address) {
    this.logger.info('[dubbo-registry#client] try to connect to %s:%s', address.host, address.port);
    this._conn = new Connection(Object.assign({}, this.options, address));
    this._conn.once('close', () => { this.emit('conn_close'); });
    this._conn.on('request', req => { this._handleRequest(req); });
    this._conn.on('error', err => {
      if (this._conn.inited) {
        this._error(err);
      }
    });
    yield this._conn.ready();

    // login
    this._login = yield this._send({
      login: {
        username: this.options.username,
        password: this.options.password,
        application: this.options.appName,
        dubbo: Constants.DUBBO_VERSION,
      },
    });
    if (!this._login) {
      return false;
    }
    this.emit('login');
    this.logger.info('[dubbo-registry#client] login to %s:%s success', address.host, address.port);
    yield this._recover();
    return true;
  }

  * _recover() {
    for (const item of this._subscribed.values()) {
      yield this._callFn('_doSubscribe', item.url);
    }
    for (const url of this._published.values()) {
      yield this._callFn('_register', url);
    }
  }

  * _send(data) {
    const res = yield this._conn.sendRequest(data);
    this._handleResponse(res);
    return res.status === 'ok';
  }

  * _sendUrl(url, type) {
    const map = {};
    if (this.isOldRegistry) {
      map[type] = {
        [url.serviceKey]: url.toParameterString(),
      };
    } else {
      map[type] = url.toFullString();
    }
    map.check = false; // TODO:
    try {
      return yield this._send(map);
    } catch (err) {
      this._error(err);
      return false;
    }
  }

  _normalizeAddr(addr) {
    const arr = addr.split(':');
    return arr.length === 1 ? {
      host: arr[0],
      port: this.options.defaultPort,
    } : {
      host: arr[0],
      port: Number(arr[1]),
    };
  }

  _handleRequest(req) {
    if (!req.isEvent && req.data) {
      this._handleResponse(req.data);
    }
  }

  _handleResponse(res) {
    this.logger.info('[dubbo-registry#client] received data => %j', res);
    if (!res) {
      return;
    }
    if (res.dubbo) {
      this._registryVersion = res.dubbo;
    }
    if (res.notify) {
      this._onNotify(res.notify);
    }
    // TODO:
    // if (res.route) {}
    // if (res.override) {}
    // if (res.forbid) {}
    if (res.sync) {
      this._onSync(res.sync);
    }
    // if (res.redirect) {}
    if (res.message) {
      const err = new Error(res.message);
      err.name = 'DubboRegistryServerError';
      this._error(err);
    }
  }

  _onNotify(addresses) {
    let urls;
    let key;
    if (is.array(addresses)) {
      if (!addresses.length) {
        return;
      }
      urls = addresses.map(address => URL.valueOf(address));
      key = urls[0].serviceKey;
      urls = urls.filter(url => {
        const category = url.getParameter(Constants.CATEGORY_KEY, Constants.DEFAULT_CATEGORY);
        return category === Constants.PROVIDERS_CATEGORY;
      }).map(url => url.toFullString());
    } else {
      urls = [];
      // @example:
      // -----------
      // {
      //   "com.gxc.demo.DemoService:1.0.0": {
      //     "dubbo://127.0.0.1:12200/com.gxc.demo.DemoService": "anyhost=true&application=xxx&codec=dubbo&dubbo=2.5.3&interface=com.gxc.demo.DemoService&methods=sayHello&pid=41113&revision=1.0.0&side=provider&threads=200&timestamp=1487577615567&version=1.0.0"
      //   }
      // }
      for (const dataId in addresses) {
        let serviceName = dataId;
        let group;
        let version;
        if (serviceName.includes('/')) {
          const arr = serviceName.split('/');
          group = arr[0];
          serviceName = arr[1];
        }
        if (serviceName.includes(':')) {
          const arr = serviceName.split(':');
          serviceName = arr[0];
          version = arr[1];
        }
        const urlMap = addresses[dataId];
        for (const address in urlMap) {
          if (address.startsWith(Constants.OVERRIDE_PROTOCOL + '://') || !urlMap[address]) {
            continue;
          }
          const url = URL.valueOf(`${address}?${urlMap[address]}`);
          if (!url.path) {
            url.path = serviceName;
          }
          if (group) {
            url.parameters.group = group;
          }
          if (version) {
            url.parameters.version = version;
          }
          urls.push(url);
        }
      }
      if (!urls.length) {
        return;
      }
      key = urls[0].serviceKey;
      urls = urls.map(url => url.toFullString()).sort();
    }
    const cache = this._subscribed.get(key);
    if (cache) {
      if (JSON.stringify(cache.value) === JSON.stringify(urls)) {
        this.logger.info('[dubbo-registry#client] subscribe value no change for key => %s', key);
      } else {
        process.nextTick(() => { this.emit(key, urls); });
        cache.value = urls;
        if (this._localCache) {
          this._localCache.write(cache.url, urls);
        }
      }
    } else {
      this.logger.warn('[dubbo-registry#client] can\'t find subscribe info for key => %s', key);
    }
  }

  _onSync(rs) {
    this.logger.info('[dubbo-registry#client] Received sync registry addresses => %j', rs);
    if (!rs || !rs.length) {
      return;
    }
    this._syncRegistries = rs.map(r => this._normalizeAddr(r));
    const conn = this._conn;
    // 如果是F5虚拟IP地址，则重连
    if (conn && conn.isOK) {
      const addr = `${conn.options.host}:${conn.options.port}`;
      if (!rs.includes(addr)) {
        this.logger.info('[dubbo-registry#client] current address => %s:%s not in sync registry addresses => %j, so do reconnect.',
          conn.options.host, conn.options.port, rs);
        conn.close();
      }
    }
  }

  _error(err) {
    if (!this._running || err.__emited) {
      return;
    }
    err.__emited = true;
    setImmediate(() => { this.emit('error', err); });
  }
}

module.exports = RegistryClient;
