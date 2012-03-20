"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu, resources: Cr} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://socialdev/lib/unload+.js");
Cu.import("resource://socialdev/lib/registry.js");

const EXPORTED_SYMBOLS = ["baseWidget"];

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

function baseWidget(aWindow) {
  this.create(aWindow);

  Services.obs.addObserver(this, 'social-service-init-ready', false);
  Services.obs.addObserver(this, 'social-service-changed', false);
  Services.obs.addObserver(this, 'social-service-deactivated', false);

  let self = this;
  unload(function() {
    self.remove();
  }, aWindow);

  let service = providerRegistry().currentProvider;
  if (service) {
    this.setProvider(service);
  }
}
baseWidget.prototype = {
  create: function(aWindow) {},
  observe: function(aSubject, aTopic, aData) {
    if (aTopic == 'social-service-changed') {
      this.setProvider(providerRegistry().currentProvider);
    }
    else if (aTopic == 'social-service-init-ready') {
      let registry = providerRegistry();
      let service = registry.getNamed(aData);
      if (service == registry.currentProvider) {
        this.setProvider(service);
      }
    }
    else if (aTopic == 'social-service-deactivated') {
      let registry = providerRegistry()
      let service = registry.getNamed(aData);
      if (service == registry.currentProvider)
        this.disable();
    }
  },
  setProvider: function(aProvider) {},
  enable: function(aIconURL, aTooltiptext) {},
  disable: function() {},
  remove: function() {
    this._widget.parentNode.removeChild(this._widget);
  }
}
