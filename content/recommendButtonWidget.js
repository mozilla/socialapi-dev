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

    worker.port.onmessage = function(evt) {
      if (evt.data.topic === 'user-recommend-prompt-response') {
        let data = evt.data.data;
        self.enable(data.img, data.message);
      };
    };
    worker.port.postMessage({topic: "user-recommend-prompt"});
  },
  enable: function(aIconURL, aTooltiptext) {
    let widget = window.document.getElementById("social-recommend-button");
    widget.setAttribute("tooltiptext", aTooltiptext); // XXX - 'message' not in spec.
    widget.setAttribute("src", aIconURL);
    widget.removeAttribute("hidden");
  },
  disable: function() {
    let widget = window.document.getElementById("social-recommend-button");
    widget.setAttribute("hidden", "true");
    widget.setAttribute("tooltiptext", "");
    widget.setAttribute("src", "");
  },
  remove: function() {
    this.disable();
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