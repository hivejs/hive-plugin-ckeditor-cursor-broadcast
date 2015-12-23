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

var vdom = require('virtual-dom')
  , h = vdom.h
  , nodeAt = require('dom-ot/lib/ops/node-at')
  , pathTo = require('dom-ot/lib/path-to')
  , jsonParse = require('json-stream')
  , through = require('through2')
  , ObservValue = require('observ')
  , ObservStruct = require('observ-struct')
  , ObservVarhash = require('observ-varhash')

module.exports = setup
module.exports.consumes = ['ui', 'editor', 'presence']
function setup(plugin, imports, register) {
  var ui = imports.ui

  ui.page('/documents/:id', function(ctx, next) {
    // This plugin works with the default html editor only
    if(ui.state.document.get('type') !== 'html') return next()

    ui.state.put('cursorBroadcast', ObservStruct({
      cursors: ObservVarhash()
    , area: ObservValue({top:0,left:0,height:0,width:0})
    }))

    var state = ui.state.cursorBroadcast

    ui.state.events['editor:load'].listen(function(editableDocument) {
      var tree = h('div.Cursors')
        , rootNode = vdom.create(tree)
        , broadcast = ctx.broadcast.createDuplexStream(new Buffer('cursors'))
        , editorRoot = editableDocument.rootNode

      document.querySelector('.Editor__content').appendChild(rootNode)

      ui.state(function(snapshot) {
        var newtree = render(snapshot)
        var patches = vdom.diff(tree, newtree)
        vdom.patch(rootNode, patches)
        tree = newtree
        rootNode.scrollTop = editorRoot.scrollY
      })

      // As soon as doc is initialized, listen on broadcast
      editableDocument.on('init', function() {
        broadcast
        .pipe(jsonParse())
        .pipe(through.obj(function(broadcastCursors, enc, cb) {
          // Convert all to coordinates
          var cursors = pathsToCoordinates(broadcastCursors, editorRoot, window)
          // update per user
          for(var userId in cursors) {
            if(userId == ui.state.user.get('id')) continue
            state.cursors.put(userId, cursors[userId])
          }
          cb()
        }))
      })

      // If the main editor window is scrolled, scroll the cursors, too
      editorRoot.addEventListener('scroll', function() {
        rootNode.scrollTop = editorRoot.scrollTop
        rootNode.scrollLeft = editorRoot.scrollLeft
      })

      setInterval(function() {
        // Broadcast the caret regularly
        var sel = window.getSelection()
          , range = sel.getRangeAt(0) // XXX: Might make sense to broadcast more than one
        try {
          var obj = {
            start: [pathTo(range.startContainer, editorRoot), range.startOffset]
          , end: [pathTo(range.endContainer, editorRoot), range.endOffset]
          }
          broadcast.write(JSON.stringify(obj)+'\n')
        }catch(e) {
          console.log(e)
        }

        // adjust canvas regularly
        state.area.set(editorRoot.getBoundingClientRect())
      }, 1000)

    })

    function render(state) {
      var bodyRect = document.querySelector('.body').getBoundingClientRect()
      return h('div.Cursors', {style: {
          // Position container directly above the editing area
            top: (state.cursorBroadcast.area.top+window.scrollY-bodyRect.top)+'px'
          , left: (state.cursorBroadcast.area.left+window.scrollX)+'px'
          , width: state.cursorBroadcast.area.width+'px'
          , height: state.cursorBroadcast.area.height+'px'
          }
        },
        // Visualize cursors by drawing a line for each author
        Object.keys(state.cursorBroadcast.cursors)
        .filter(function(authorId) {return !!state.presence.users[authorId]}) // only users that are present
        .filter(function(authorId) {return authorId !== state.user.id}) // not me
        .map(function(authorId) {
          var user = state.presence.users[authorId]
            , cursors = state.cursorBroadcast.cursors[authorId]
          return cursors.map(function(cursor) {
            return h('div.Cursors__Cursor', {
              attributes:{ title: user.name}
            , style: {
                  'border-color': user.color || '#777'
                , 'left': cursor.x+'px'
                , 'top': cursor.y+'px'
                , 'width': cursor.width+'px'
                , 'height': cursor.height+'px'
                }
              })
          }).reduce(function(result, el) {
            return result.concat(el)
          }, [])
        })
        .concat(
        // Display the authors name alongside their cursor
        Object.keys(state.cursorBroadcast.cursors)
        .filter(function(authorId) {return !!state.presence.users[authorId]}) // only users that are present
        .filter(function(authorId) {return authorId !== state.user.id}) // not me
        .map(function(authorId) {
          var cursor = state.cursorBroadcast.cursors[authorId][0]
          return h('div.Cursors__Label', {
            style: {
                'left': cursor.x+'px'
              , 'top': 'calc('+cursor.y+'px - .4cm)'
              }
            }, state.presence.users[authorId].name)
        })
        )
        .concat(
        // Scroll fix! To ensure scrollability we add an empty cursor right at teh end of the document
        h('div.Cursors__Cursor', {style: {
          top: (ctx.editableDocument.rootNode.clientHeight+100)+'px' // +100 because there might be some margin or sth, better safe than sorry...
        }})
        )

      )
    }

    next()
  })

  register()
}

function pathsToCoordinates(cursors, rootNode, editorWindow) {
  var coordinates = {}
  Object.keys(cursors).forEach(function(userId) {
    try {
      // Create a range
      var range = document.createRange()
      range.setStart(nodeAt(cursors[userId].start[0], rootNode), cursors[userId].start[1])
      range.setEnd(nodeAt(cursors[userId].end[0], rootNode), cursors[userId].end[1])
      // ... and determine its dimensions
      var rects = Array.prototype.slice.call(range.getClientRects())
        , editorRect = rootNode.getBoundingClientRect()
      coordinates[userId] = rects.map(function (rect) {
        return {
          x: rect.left+editorWindow.scrollX-editorRect.left
        , y: rect.top+editorWindow.scrollY-editorRect.top
        , width: rect.width
        , height: rect.height
        }
      })
    }catch(e) {
      console.log(e)
    }
  })
  return coordinates
}
