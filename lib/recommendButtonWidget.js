"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://socialdev/lib/registry.js");
Cu.import("resource://socialdev/lib/baseWidget.js");

const EXPORTED_SYMBOLS = ["RecommendButton"];

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";


function RecommendButton(aWindow) {
  baseWidget.call(this, aWindow);
  this.window = aWindow;
}
RecommendButton.prototype = {
  __proto__: baseWidget.prototype,
  create: function(aWindow) {
  },
  setProvider: function(aProvider) {
    let self = this;
    let worker = aProvider.makeWorker(this.window);

    worker.port.onmessage = function(evt) {
      if (evt.data.topic === 'user-recommend-prompt-response') {
        let data = evt.data.data;
        self.enable(data.img, data.message);
      };
    };
    worker.port.postMessage({topic: "user-recommend-prompt"});
  },
  enable: function(aIconURL, aTooltiptext) {
    let widget = this.window.document.getElementById("social-recommend-button");
    widget.setAttribute("tooltiptext", aTooltiptext); // XXX - 'message' not in spec.
    widget.setAttribute("src", aIconURL);
    widget.removeAttribute("hidden");
  },
  disable: function() {
    let widget = this.window.document.getElementById("social-recommend-button");
    widget.setAttribute("hidden", "true");
    widget.setAttribute("tooltiptext", "");
    widget.setAttribute("src", "");
  },
  remove: function() {
    this.disable();
  },
  oncommand: function(event) {
    let url = this.window.gBrowser.currentURI.cloneIgnoringRef().spec;
    Services.console.logStringMessage("recommending "+ url);
    let worker = providerRegistry().currentProvider.makeWorker(this.window)
    worker.port.postMessage({topic: "user-recommend",
                             data: {
                              url: url}
                            });
  }
}