"use strict";

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://socialdev/modules/baseWidget.js");

Components.utils.import("resource://socialdev/modules/registry.js");

function SocialRecommendButton() {
  baseWidget.call(this, window);
}
SocialRecommendButton.prototype = {
  __proto__: baseWidget.prototype,
  create: function(aWindow) {
    this.worker = null;
  },
  disable: function() {
    if (this.worker) {
      this.worker.port.close();
      this.worker = null;
    }
  },
  setProvider: function(aProvider) {
    let self = this;
    // maybe just swapping providers; close old port.
    if (this.worker) {
      this.worker.port.close();
    }
    this.worker = aProvider.makeWorker(window);
    if (!this.worker) {
      return;
    }
    let widget = document.getElementById("social-recommend-button");
    // ensure the old service data isn't there while we wait...
    widget.setAttribute("tooltiptext", "");
    widget.setAttribute("src", "");
    this.worker.port.onmessage = function(evt) {
      if (evt.data.topic === 'social.user-recommend-prompt-response') {
        let data = evt.data.data;
        widget.setAttribute("tooltiptext", data.message);
        widget.setAttribute("src", data.img);
      };
    };
    this.worker.port.postMessage({topic: "social.user-recommend-prompt"});
  },
  oncommand: function(event) {
    let url = window.gBrowser.currentURI.cloneIgnoringRef().spec;
    this.worker.port.postMessage({topic: "social.user-recommend",
                                  data: {
                                  url: url}
                            });
    Services.console.logStringMessage("recommending "+ url);
    // Note the service may respond back with a -response, which we are
    // already looking for an will update the UI.
  }
}
