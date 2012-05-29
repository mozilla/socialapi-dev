/* -*- Mode: JavaScript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/.
 */

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

function TypedStorageImpl() {}
TypedStorageImpl.prototype = {
  open: function(objType, dbName) {
    return new ObjectStore(objType, dbName);
  }
};

function ObjectStore(objType, dbName) {
  let file = Services.dirsvc.
              get("ProfD", Ci.nsIFile);
              file.append(dbName + ".sqlite");

  // Will also create the file if it does not exist
  let dbConn = Services.storage.openDatabase(file);
  this._dbConn = dbConn;

  // See if the table is already created:
  let statement;
  let tableExists = false;
  try {
    statement = dbConn.createStatement("SELECT * FROM " + objType + " LIMIT 1");
    statement.executeStep();
    tableExists = true;
  }
  catch (e) {}
  finally {
    if (statement) statement.finalize();
  }

  if (!tableExists) {
    try {
      dbConn.executeSimpleSQL("CREATE TABLE " + objType + " (id INTEGER PRIMARY KEY, key TEXT UNIQUE NOT NULL, data TEXT)");
    }
    catch (e) {
      Cu.reportError("Error while creating table: " + e);
      throw e;
    }
  }

  this._objType = objType;
}
ObjectStore.prototype = {
  get: function(key, cb) {
    let self = this;
    let value;
    let getStatement = this._dbConn.createStatement("SELECT data FROM " + this._objType + " WHERE key = :key LIMIT 1");
    getStatement.params.key = key;
    getStatement.executeAsync({
      handleResult: function(result) {
        let row = result.getNextRow();
        if (row) {
          value = JSON.parse(row.getResultByName("data"));
        }
      },
      handleError: function(error) {
        Cu.reportError("Error while selecting from table " + self._objType + ": " + error + "; " + self._dbConn.lastErrorString + " (" + this._dbConn.lastError + ")");
      },
      handleCompletion: function(reason) {
        getStatement.reset();
        if (reason != Ci.mozIStorageStatementCallback.REASON_FINISHED)
          Cu.reportError("Get query canceled or aborted! " + reason);
        else {
          if (cb) cb(key, value);
        }
      }
    });
  },

  insert: function(key, value, cb) {
    let setStatement = this._dbConn.createStatement("INSERT INTO " + this._objType + " (key, data) VALUES (:key, :data )");
    setStatement.params.key = key;
    setStatement.params.data = JSON.stringify(value);
    this._doAsyncExecute(setStatement, cb);
  },

  put: function(key, value, cb) {
    let setStatement = this._dbConn.createStatement("INSERT OR REPLACE INTO " + this._objType + " (key, data) VALUES (:key, :data )");
    setStatement.params.key = key;
    setStatement.params.data = JSON.stringify(value);
    this._doAsyncExecute(setStatement, cb);
  },

  remove: function(key, cb) {
    let removeStatement = this._dbConn.createStatement("DELETE FROM " + this._objType + " WHERE key = :key");
    removeStatement.params.key = key;
    this._doAsyncExecute(removeStatement, cb);
  },

  clear: function(cb) {
    let clearStatement = this._dbConn.createStatement("DELETE FROM " + this._objType);
    this._doAsyncExecute(clearStatement, cb);
  },

  has: function(key, cb) {
    this.get(key, function(key, data) {
      cb(data !== null);
    })
  },

  keys: function(cb) {
    let resultKeys = [];
    let keyStatement = this._dbConn.createStatement("SELECT key FROM " + this._objType);

    let self = this;
    keyStatement.executeAsync({
      handleResult: function(result) {
        let row;
        while ((row = result.getNextRow())) {
          resultKeys.push(row.getResultByName("key"));
        }
      },
      handleError: function(error) {
        Cu.reportError("Error while getting keys for " + self._objType + ": " + error + "; " + self._dbConn.lastErrorString + " (" + self._dbConn.lastError + ")");
      },
      handleCompletion: function(reason) {
        keyStatement.reset();
        if (reason != Ci.mozIStorageStatementCallback.REASON_FINISHED)
          Cu.reportError("Keys query canceled or aborted! " + reason);
        else {
          try {
            cb(resultKeys);
          }
          catch (e) {
            Cu.reportError("Error in completion callback for ObjectStore.keys(): " + e);
          }
        }
      }
    });
  },

  iterate: function(cb) {
    // sometimes asynchronous calls can make your head hurt
    let store = this;
    this.keys(function(allKeys) {
      for each(let key in allKeys) {
        store.get(key, function(k, values) {
          let result = cb(k, values);
          if (result === false) return;
        });
      }
    });
  },

  // Helper function for async execute with no results
  _doAsyncExecute: function(statement, cb) {
    let self = this;
    statement.executeAsync({
      handleResult: function(result) {},
      handleError: function(error) {
        Cu.reportError("Error while executing "+ statement+ "on"+ this._objType+ ":"+ error.message, error.result);
        if (this._dbConn) {
          Cu.reportError("database error details:"+ this._dbConn.lastErrorString+ "(" + this._dbConn.lastError + ")")
        }
      },
      handleCompletion: function(reason) {
        statement.reset();
        if (reason != Ci.mozIStorageStatementCallback.REASON_FINISHED)
          Cu.reportError("Query canceled or aborted! " + reason);
        else {
          if (cb) cb(true);
        }
      }
    });
  },

  close: function() {
    if (this._dbConn) {
      this._dbConn.asyncClose();
      this._dbConn = null;
    }
  }
};

// We create a Singleton
var TypedStorageImplSingleton = new TypedStorageImpl();

function TypedStorage() {
  return TypedStorageImplSingleton;
}
var EXPORTED_SYMBOLS = ["TypedStorage"];
