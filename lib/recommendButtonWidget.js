"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu, resources: Cr} = Components;

Cu.import("resource://socialdev/lib/console.js");
Cu.import("resource://socialdev/lib/registry.js");
Cu.import("resource://socialdev/lib/baseWidget.js");

const EXPORTED_SYMBOLS = ["RecommendButton"];

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";


function RecommendButton(aWindow) {
  baseWidget.call(this, aWindow);
}
RecommendButton.prototype = {
  __proto__: baseWidget.prototype,
  create: function(aWindow) {
    let btn = this._widget = aWindow.document.createElementNS(XUL_NS, "image");
    btn.id = "social-button";
    // disabled until we get told by the service what the message and icon are.
    btn.setAttribute("hidden", "true");
    btn.className = "social-button";
  
    btn.addEventListener("click", this.onclick.bind(this));
  
    let urlbarIcons = aWindow.document.getElementById("urlbar-icons");
    urlbarIcons.insertBefore(btn, urlbarIcons.firstChild);
  },
  setProvider: function(aProvider) {
    let self = this;
    let window = this._widget.ownerDocument.defaultView;
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
    this._widget.setAttribute("tooltiptext", aTooltiptext); // XXX - 'message' not in spec.
    this._widget.setAttribute("src", aIconURL);
    this._widget.removeAttribute("hidden");
  },
  disable: function() {
    this._widget.setAttribute("hidden", "true");
  },
  remove: function() {
    this._widget.parentNode.removeChild(this._widget);
  },
  onclick: function(event) {
    let window = event.target.ownerDocument.defaultView;
    let url = window.gBrowser.currentURI.cloneIgnoringRef().spec;
    console.log("we like "+ url);
    let worker = providerRegistry().currentProvider.makeWorker(window)
    worker.port.postMessage({topic: "user-recommend",
                             data: {
                              url: url}
                            });
  }
}