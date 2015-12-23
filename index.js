/**
 * hive.js
 * Copyright (C) 2013-2015 Marcel Klehr <mklehr@gmx.net>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
var through = require('through2')
  , JSONParse = require('json-stream')
  , path = require('path')

module.exports = setup
module.exports.consumes = ['assets', 'broadcast']

function setup(plugin, imports, register) {
  var assets = imports.assets
    , broadcast = imports.broadcast

  assets.registerModule(path.join(__dirname, 'client.js'))
  assets.registerStylesheet(path.join(__dirname, 'css/index.css'))

  var cursors = {}

  broadcast.registerChannel(new Buffer('cursors'), function(user, document, client, brdcst) {
    if(!cursors[document]) cursors[document] = {}

    client
    .pipe(JSONParse())
    .pipe(through.obj(function(myCursor, enc, callback) {
      cursors[document][user.id] = myCursor
      var obj = {}
      obj[user.id] = myCursor
      this.push(obj)
      callback()
    }))
    .pipe(JSONStringify())
    .pipe(brdcst)
    .pipe(JSONParse())
    .pipe(through.obj(function(broadcastCursors, enc, callback) {
      for(var userId in broadcastCursors) {
        cursors[document][userId] = broadcastCursors[userId]
      }
      this.push(broadcastCursors)
      callback()
    }))
    .pipe(JSONStringify())
    .pipe(client)

    client.write(JSON.stringify(cursors[document])+'\n')
  })

  register()
}

function JSONStringify() {
  return through.obj(function(buf, enc, cb) {
    this.push(JSON.stringify(buf)+'\n')
    cb()
  })
}
