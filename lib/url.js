'use strict';

const is = require('is-type-of');
const qs = require('querystring');
const Constants = require('./const');
const urlparse = require('url').parse;
const urlformat = require('url').format;

class URL {
  constructor(options) {
    this.protocol = options.protocol;
    this.username = options.username || null;
    this.password = options.password || null;
    this.host = options.host;
    this.port = options.port != null ? Number(options.port) : 0;

    if (options.path && options.path.startsWith('/')) {
      this.path = options.path.slice(1);
    } else {
      this.path = options.path;
    }
    this.parameters = options.parameters || {};
  }

  get auth() {
    if (!this.username && !this.password) {
      return null;
    }
    const username = this.username || '';
    const password = this.password || '';
    return `${username}:${password}`;
  }

  set auth(val) {
    if (!val) {
      return;
    }
    const arr = val.split(':');
    this.username = arr[0];
    this.password = arr[1];
  }

  get address() {
    return this.port <= 0 ? this.host : `${this.host}:${this.port}`;
  }

  get serviceInterface() {
    return this.getParameter(Constants.INTERFACE_KEY, this.path);
  }

  get serviceKey() {
    const inf = this.serviceInterface;
    if (!inf) {
      return null;
    }
    let key = '';
    const group = this.getParameter(Constants.GROUP_KEY);
    if (group) {
      key += `${group}/`;
    }
    key += inf;
    const version = this.getParameter(Constants.VERSION_KEY);
    if (version) {
      key += `:${version}`;
    }
    return key;
  }

  getParameter(key, defaultValue) {
    let value = this.parameters[key];
    if (value == null) {
      value = defaultValue || this.parameters[Constants.DEFAULT_KEY_PREFIX + key];
    }
    return value;
  }

  addParameter(key, value) {
    let parameters;
    if (is.object(key)) {
      parameters = Object.assign({}, this.parameters, key);
    } else {
      parameters = Object.assign({}, this.parameters, {
        [key]: value,
      });
    }
    // return a new url
    return new URL({
      protocol: this.protocol,
      username: this.username,
      password: this.password,
      host: this.host,
      port: this.port,
      path: this.path,
      parameters,
    });
  }

  toIdentityString() {
    return urlformat({
      protocol: this.protocol,
      slashes: true,
      host: this.port > 0 ? `${this.host}:${this.port}` : this.host,
      hostname: this.host,
      port: this.port,
    });
  }

  toParameterString() {
    return qs.stringify(this.parameters);
  }

  toFullString() {
    return urlformat({
      protocol: this.protocol,
      slashes: true,
      host: this.port > 0 ? `${this.host}:${this.port}` : this.host,
      hostname: this.host,
      port: this.port,
      pathname: this.path,
      query: this.parameters,
    });
  }

  static valueOf(str) {
    const urlObj = urlparse(str, true);
    const url = new URL({
      protocol: urlObj.protocol && urlObj.protocol.replace(/:?$/, ''),
      host: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      parameters: urlObj.query,
    });
    url.auth = urlObj.auth;
    return url;
  }
}

module.exports = URL;
