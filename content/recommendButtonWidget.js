"use strict";

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://socialdev/modules/baseWidget.js");

function SocialRecommendButton() {
  baseWidget.call(this, window);
}
SocialRecommendButton.prototype = {
  __proto__: baseWidget.prototype,
  create: function(aWindow) {
  },
  setProvider: function(aProvider) {
    let self = this;
    let worker = aProvider.makeWorker(window);
    let widget = document.getElementById("social-recommend-button");
    // ensure the old service data isn't there while we wait...
    widget.setAttribute("tooltiptext", ""); // XXX - 'message' not in spec.
    widget.setAttribute("src", "");
    if (!worker) {
      this.disable();
      return;
    }
    worker.port.onmessage = function(evt) {
      if (evt.data.topic === 'user-recommend-prompt-response') {
        let data = evt.data.data;
        widget.setAttribute("tooltiptext", data.message); // XXX - 'message' not in spec.
        widget.setAttribute("src", data.img);
      };
    };
    worker.port.postMessage({topic: "user-recommend-prompt"});
  },
  oncommand: function(event) {
    let providerRegistry = Cc["@mozilla.org/socialProviderRegistry;1"]
                            .getService(Ci.mozISocialRegistry);
    let url = window.gBrowser.currentURI.cloneIgnoringRef().spec;
    let worker = providerRegistry.currentProvider.makeWorker(window)
    worker.port.postMessage({topic: "user-recommend",
                             data: {
                              url: url}
                            });
    Services.console.logStringMessage("recommending "+ url);
  }
}