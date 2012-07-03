let Ci = Components.interfaces;
let Cu = Components.utils;

function SecurityStatusListener() {
  return {
    _isBusy: false,
    get statusMeter() {
      delete this.statusMeter;
      return this.statusMeter = document.getElementById("statusbar-icon");
    },
    get securityButton() {
      delete this.securityButton;
      return this.securityButton = document.getElementById("security-button");
    },
    get securityLabel() {
      delete this.securityLabel;
      return this.securityLabel = document.getElementById("security-status");
    },
    get securityDisplay() {
      delete this.securityDisplay;
      return this.securityDisplay = document.getElementById("security-display");
    },

    QueryInterface: function(aIID) {
      if (aIID.equals(Ci.nsIWebProgressListener)   ||
          aIID.equals(Ci.nsIWebProgressListener2)  ||
          aIID.equals(Ci.nsISupportsWeakReference) ||
          aIID.equals(Ci.nsISupports))
        return this;
      throw Components.results.NS_NOINTERFACE;
    },
    onStateChange: function(/*in nsIWebProgress*/ aWebProgress,
                       /*in nsIRequest*/ aRequest,
                       /*in unsigned long*/ aStateFlags,
                       /*in nsresult*/ aStatus) {
      if (aStateFlags & Ci.nsIWebProgressListener.STATE_START &&
          aStateFlags & Ci.nsIWebProgressListener.STATE_IS_NETWORK) {
        this.statusMeter.value = 0;
        this.statusMeter.parentNode.collapsed = false;
        this.securityLabel.collapsed = true;
      }
      else if (aStateFlags & Ci.nsIWebProgressListener.STATE_STOP &&
               aStateFlags & Ci.nsIWebProgressListener.STATE_IS_NETWORK) {
        this.statusMeter.parentNode.collapsed = true;
        this.securityLabel.collapsed = false;
      }
    },

    onProgressChange: function(/*in nsIWebProgress*/ aWebProgress,
                          /*in nsIRequest*/ aRequest,
                          /*in long*/ aCurSelfProgress,
                          /*in long */aMaxSelfProgress,
                          /*in long */aCurTotalProgress,
                          /*in long */aMaxTotalProgress) {
      if (aMaxTotalProgress > 0) {
        let percentage = (aCurTotalProgress * 100) / aMaxTotalProgress;
        this.statusMeter.value = percentage;
      }
    },

    onLocationChange: function(/*in nsIWebProgress*/ aWebProgress,
                          /*in nsIRequest*/ aRequest,
                          /*in nsIURI*/ aLocation) {
      this.securityDisplay.setAttribute('label', aLocation.host);
    },

    onStatusChange: function(/*in nsIWebProgress*/ aWebProgress,
                        /*in nsIRequest*/ aRequest,
                        /*in nsresult*/ aStatus,
                        /*in wstring*/ aMessage) {
    },

    onSecurityChange: function(/*in nsIWebProgress*/ aWebProgress,
                          /*in nsIRequest*/ aRequest,
                          /*in unsigned long*/ aState) {
      const wpl_security_bits = Ci.nsIWebProgressListener.STATE_IS_SECURE |
                                Ci.nsIWebProgressListener.STATE_IS_BROKEN |
                                Ci.nsIWebProgressListener.STATE_IS_INSECURE |
                                Ci.nsIWebProgressListener.STATE_SECURE_HIGH |
                                Ci.nsIWebProgressListener.STATE_SECURE_MED |
                                Ci.nsIWebProgressListener.STATE_SECURE_LOW;
      var browser = document.getElementById("browser");
      var level;

      switch (aState & wpl_security_bits) {
        case Ci.nsIWebProgressListener.STATE_IS_SECURE | Ci.nsIWebProgressListener.STATE_SECURE_HIGH:
          level = "high";
          break;
        case Ci.nsIWebProgressListener.STATE_IS_SECURE | Ci.nsIWebProgressListener.STATE_SECURE_MED:
        case Ci.nsIWebProgressListener.STATE_IS_SECURE | Ci.nsIWebProgressListener.STATE_SECURE_LOW:
          level = "low";
          break;
        case Ci.nsIWebProgressListener.STATE_IS_BROKEN:
          level = "broken";
          break;
      }
      if (level) {
        this.securityButton.setAttribute("level", level);
        this.securityButton.hidden = false;
        this.securityLabel.setAttribute("label", browser.securityUI.tooltipText);
      }
      else {
        this.securityButton.hidden = true;
        this.securityButton.removeAttribute("level");
      }
      this.securityButton.setAttribute("tooltiptext", browser.securityUI.tooltipText);
    },
    onProgressChange64: function() {
      return this.onProgressChange(aWebProgress, aRequest,
        aCurSelfProgress, aMaxSelfProgress, aCurTotalProgress,
        aMaxTotalProgress);
    },
    onRefreshAttempted: function() {
      return true;
    }
  }
}

Object.defineProperty(window, "browser", {
  get: function() { return window.document.getElementById('browser'); }
});

var options = window.arguments[0].wrappedJSObject;
dump("window options are "+JSON.stringify(window.arguments)+"\n");
window.addEventListener('load', function() {
  browser.addProgressListener(SecurityStatusListener(),
                            Ci.nsIWebProgress.NOTIFY_ALL);
  document.title = options.title;
  browser.setAttribute('src', options.url);
});

window.loadURI = function loadURI(URI) {
  browser.setAttribute('src', URI);
}
