// This is the API we expose to workers.  Sometimes we will use this
// API to call into the worker and sometimes the worker will call into
// us.  Sometimes these calls will happen as a direct response to a previous
// call (ie, a request is made then a response is returned).  Other times the
// call might be unsolicited and a one-shot.

EXPORTED_SYMBOLS = ["workerAPI"];

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

var notification = {};
Cu.import("resource://socialdev/modules/notification.js", notification);
Cu.import("resource://gre/modules/Services.jsm");

function workerAPI(worker, service) {
  this.initialize(worker, service)
}

workerAPI.prototype = {
  initialize: function(worker, service) {
    this.service = service;
    this.worker = worker;
    this.cookieTimer = null;
    if (!worker)
      return;
    // get the host of the service for simple cookie matching.
    // Note we use "URLPrefix" for dev, but should probably use the worker
    // URL once that is actually hosted on real sites...
    this.serviceHost = Components.classes["@mozilla.org/network/io-service;1"]
                       .getService(Components.interfaces.nsIIOService)
                       .newURI(service.URLPrefix, null, null)
                       .host;

    Services.obs.addObserver(this, 'cookie-changed', false);
    worker.port.onmessage = function(event) {
      let {topic, data} = event.data;
      if (!topic) {
        return;
      }
      try {
        let handler = this.workerapi[topic];
        if (!handler) {
          Cu.reportError("worker called unimplemented API function '" + topic + "'");
          return;
        }
        handler.call(this, worker, data);
      }
      catch (ex) {
        Cu.reportError("failed to handle api message '" + topic + "': " + ex + "\n" + ex.stack);
      }
    }.bind(this);
    // and send an "intro" message so the worker knows this is the port
    // used for the api.
    // later we might even include an API version - version 0 for now!
    worker.port.postMessage({topic: "social.initialize"});
  },

  shutdown: function() {
    try {
      Services.obs.removeObserver(this, 'cookie-changed');
    }
    catch (ex) {
      Cu.reportError(ex);
    }
    try {
      if (this.cookieTimer) {
        this.cookieTimer.cancel();
      }
    }
    catch (ex) {
      Cu.reportError(ex);
    }
    this.cookieTimer = null;
    if (this.worker)
      this.worker.port.close();
    this.worker = this.service = null;
  },

  cookieMatchesService: function(cookie) {
    if (!cookie) {
      return false;
    }
    cookie = cookie.QueryInterface(Ci.nsICookie2);
    if (cookie.host[0] == ".") {
      // it is a domain cookie, so just check the end of the service domain
      return this.serviceHost.substr(-cookie.host.length) == cookie.host;
    }
    // a cookie for a specific host, so must match exactly.
    return cookie.rawHost === this.serviceHost;
  },

  // We use a 1 second timer for the cookie notification to prevent a "flood"
  // of notifications.
  notifyWorkerOfCookieChange: function() {
    let worker = this.worker;
    let event = {
      notify: function(timer) {
        this.worker.port.postMessage({topic: "social.cookie-changed"});
        this.cookieTimer = null;
      }.bind(this)
    }
    this.cookieTimer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    this.cookieTimer.initWithCallback(event, 1000, Ci.nsITimer.TYPE_ONE_SHOT);
  },

  observe: function(aSubject, aTopic, aData) {
    // very simple - we don't say what the cookie value is, just that it
    // might have changed.  In some cases we will deliver a false-positive
    // (ie, the cookie didn't really change) but try hard to avoid missing
    // when one might have changed.
    if (aTopic != 'cookie-changed') {
      return;
    }
    // if we already have a timer scheduled then no need to bother checking.
    if (this.cookieTimer) {
      return;
    }
    switch (aData) {
      // All the 'single cookie' notifications.
      case 'deleted':
      case 'added':
      case 'changed':
        if (this.cookieMatchesService(aSubject)) {
          this.notifyWorkerOfCookieChange();
        }
        break;
      // The 'array of cookies' notification.
      case 'batch-deleted':
        let enumerate = aSubject.QueryInterface(Ci.nsIArray).enumerate();
        while (enumerate.hasMoreElements()) {
          if (this.cookieMatchesService(enumerate.getNext()))
            this.notifyWorkerOfCookieChange();
            return;
        }
        break;
      // The 'all cookies might have changed' notifications.
      case 'cleared':
      case 'reload':
        this.notifyWorkerOfCookieChange();
        break;
    }
  },

  // This is the API exposed to the worker itself by way of messages.
  workerapi: {
    'social.notification-create': function(worker, data) {
      let n;
      let {icon, title, body, id} = data;
      let onclick = function() {
        worker.port.postMessage({topic: "social.notification-click",
                          data: {id: id}});
      }
      let onhide = function() {
        n = null;
      }
      n = notification.Notification(icon, title, body, id, onclick, onhide);
      n.show();
    },
    'social.ambient-notification-update': function(worker, data) {
      let ani = this.service.createAmbientNotificationIcon(data.name);
      if (data.background) {
        ani.setBackground(data.background);
      }
      if (data.counter) {
        ani.setCounter(data.counter);
      }
      if (data.contentPanel) {
        ani.setContentPanel(data.contentPanel);
      }
    },
    'social.ambient-notification-area': function(worker, data) {
      if (data.background) {
        this.service.setAmbientNotificationBackground(data.background);
      }
      if (data.portrait) {
        this.service.setAmbientNotificationPortrait(data.portrait);
      }
    },
  }
}
