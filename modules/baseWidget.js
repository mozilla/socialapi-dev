"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

Cu.import("resource://socialdev/components/registry.js");

const EXPORTED_SYMBOLS = ["baseWidget"];

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

const topics = [
  'social-browsing-current-service-changed',
  'social-browsing-enabled',
  'social-browsing-disabled'
];

function baseWidget(aWindow) {
  this.create(aWindow);

  for each (let topic in topics) {
    Services.obs.addObserver(this, topic, false);
  }
}
baseWidget.prototype = {
  create: function(aWindow) {},
  observe: function(aSubject, aTopic, aData) {
    //let registry = Cc["@mozilla.org/socialProviderRegistry;1"]
    //                        .getService(Ci.mozISocialRegistry);
    if (aTopic == 'social-browsing-current-service-changed') {
      this.setProvider(registry().currentProvider);
    }
    else if (aTopic == 'social-browsing-enabled') {
      this.enable();
    }
    else if (aTopic == 'social-browsing-disabled') {
      this.disable();
    } else if (aTopic == 'social-browsing-ambient-notification-changed') {
      this.ambientNotificationChanged();
    }
  },
  setProvider: function(aProvider) {},
  enable: function() {},
  disable: function() {},
  ambientNotificationChanged: function() {},
  remove: function() {
    for each (let topic in topics) {
      Services.obs.removeObserver(this, topic, false);
    }
    if (this._widget) {
      this._widget.parentNode.removeChild(this._widget);
    }
  },
  debugLog: function(msg) {
    try {
      let prefBranch = Services.prefs.getBranch("social.debug").QueryInterface(Ci.nsIPrefBranch2);
      debugEnabled = prefBranch.getBoolPref("enabled");
      if (!debugEnabled) return;
    } catch(e) {
      return;
    }
    Services.console.logStringMessage(new Date().toISOString() + " [socialdebug] " + msg);
  }
}
