"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu, resources: Cr} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://socialdev/lib/console.js");
Cu.import("resource://socialdev/lib/listen.js");
Cu.import("resource://socialdev/lib/unload+.js");
Cu.import("resource://socialdev/lib/watchWindows.js");
Cu.import("resource://socialdev/lib/registry.js");

const EXPORTED_SYMBOLS = ["RecommendButton"];

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

function RecommendButton(aWindow) {
  this.create(aWindow);

  Services.obs.addObserver(this, 'social-provider-changed', false);
  Services.obs.addObserver(this, 'social-provider-closed', false);

  let self = this;
  unload(function() {
    self.remove();
  }, aWindow);
}
RecommendButton.prototype = {
  create: function(aWindow) {
    let btn = this.btn = aWindow.document.createElementNS(XUL_NS, "image");
    btn.id = "social-button";
    // disabled until we get told by the service what the message and icon are.
    btn.setAttribute("hidden", "true");
    btn.className = "social-button";
  
    btn.addEventListener("click", this.onclick.bind(this));
  
    let urlbarIcons = aWindow.document.getElementById("urlbar-icons");
    urlbarIcons.insertBefore(btn, urlbarIcons.firstChild);
  },
  observer: function(aSubject, aTopic, aData) {
    if (aTopic == 'social-provider-changed') {
      dump("***** social-provider-changed to "+aData+"\n");
      this.setProvider(providerRegistry.currentProvider);
    }
    else if (aTopic == 'social-provider-closed') {
      this.disable();
    }
  },
  setProvider: function(aProvider) {
    let self = this;
    let window = this.btn.ownerDocument.defaultView;
    let worker = aProvider.makeWorker(window);

    worker.port.onmessage = function(evt) {
      if (evt.data.topic === 'user-recommend-prompt-response') {
        let data = evt.data.data;
        self.enable(data.img, data.message);
      };
    };
    worker.port.postMessage({topic: "user-recommend-prompt"});
  },
  enable: function(aIconURL, aTooltiptext) {
    this.btn.setAttribute("tooltiptext", aTooltiptext); // XXX - 'message' not in spec.
    this.btn.setAttribute("src", aIconURL);
    this.btn.removeAttribute("hidden");
  },
  disable: function() {
    this.btn.setAttribute("hidden", "true");
  },
  remove: function() {
    this.btn.parentNode.removeChild(this.btn);
  },
  onclick: function(event) {
    let window = event.target.ownerDocument.defaultView;
    let url = window.gBrowser.currentURI.cloneIgnoringRef().spec;
    dump("we like"+ url+"\n");
    let worker = window.displayedSocialService.makeWorker(window)
    worker.port.postMessage({topic: "user-recommend",
                             data: {
                              url: url}
                            });
  }
}