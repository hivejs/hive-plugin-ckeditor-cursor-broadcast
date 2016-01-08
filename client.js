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

const SET_CANVAS_AREA = 'CURSORBROADCASTCKEDITOR_SET_CANVAS_AREA'
const UPDATE_CURSORS = 'CURSORBROADCASTCKEDITOR_UPDATE_CURSORS'

module.exports = setup
module.exports.consumes = ['ui', 'editor', 'presence']
module.exports.provides = ['cursorBroadcastCkeditor']
function setup(plugin, imports, register) {
  var ui = imports.ui
    , editor = imports.editor

  ui.reduxReducerMap.cursorBroadcastCkeditor = reducer
  function reducer(state, action) {
    if(!state) {
      return {
        cursors: {}
      , area: {top:0, left:0, height:0, width:0}
      }
    }
    if(UPDATE_CURSORS === action.type) {
      return {...state, cursors: {...state.cursors, ...action.payload}}
    }
    if(SET_CANVAS_AREA === action.type) {
      return {...state, area: action.payload}
    }
    return state
  }

  var cursorBroadcast = {
    action_updateCursors: function(cursors) {
      return {type: UPDATE_CURSORS, payload: cursors}
    }
  , action_setCanvasArea: function(area, scrollHeight) {
      return {type: SET_CANVAS_AREA, payload: {
        top: area.top
      , left: area.left
      , height: area.height
      , width: area.width
      , scrollHeight
      }}
    }
  }

  editor.onLoad((editableDocument, broadcast) => {
    // This plugin works with ckeditor only
    if(ui.store.getState().editor.editor !== 'CKeditor') return

    var tree = h('div.Cursors')
      , rootNode = vdom.create(tree)
    document.querySelector('.Editor__content').appendChild(rootNode)
    ui.store.subscribe(function() {
      var newtree = render(ui.store)
      var patches = vdom.diff(tree, newtree)
      vdom.patch(rootNode, patches)
      tree = newtree
      rootNode.scrollTop = editorRoot.scrollY
    })

    var editorRoot = editableDocument.rootNode
    cursorBroadcast.stream = broadcast.createDuplexStream(new Buffer('cursors'))

    // As soon as doc is initialized, listen on broadcast
    editableDocument.on('init', function() {
      cursorBroadcast.stream
      .pipe(jsonParse())
      .pipe(through.obj(function(broadcastCursors, enc, cb) {
        // Convert all to coordinates
        var cursors = pathsToCoordinates(broadcastCursors, editorRoot, window)
        // Don't highlight this user's selection
        var thisUser = ui.store.getState().session.user.id
        if(cursors[thisUser]) delete cursors[thisUser]
        // update
        ui.store.dispatch(cursorBroadcast.action_updateCursors(cursors))
        cb()
      }))
    })

    // If the main editor window is scrolled, scroll the cursors, too
    editorRoot.addEventListener('scroll', function() {
      rootNode.scrollTop = editorRoot.scrollTop
      rootNode.scrollLeft = editorRoot.scrollLeft
    })

    editorRoot.addEventListener('click', collectCursor)
    editorRoot.addEventListener('keydown', collectCursor)
    function collectCursor() {
      var sel = window.getSelection()
        , range = sel.getRangeAt(0) // XXX: Might make sense to broadcast more than one
      try {
        var obj = {
          start: [pathTo(range.startContainer, editorRoot), range.startOffset]
        , end: [pathTo(range.endContainer, editorRoot), range.endOffset]
        }
        cursorBroadcast.stream.write(JSON.stringify(obj)+'\n')
      }catch(e) {
        console.log(e)
      }
    }

    setTimeout(updateCanvasArea, 100)
    window.addEventListener('scroll', updateCanvasArea)
    window.addEventListener('resize', updateCanvasArea)
    function updateCanvasArea() {
      ui.store.dispatch(
        cursorBroadcast.action_setCanvasArea(editorRoot.getBoundingClientRect(), editorRoot.scrollHeight)
      )
    }
  })

  function render(store) {
    var state = store.getState()
      , cursorBroadcastState = state.cursorBroadcastCkeditor
    var bodyRect = document.querySelector('.body').getBoundingClientRect()
    return h('div.Cursors', {style: {
        // Position container directly above the editing area
          top: (cursorBroadcastState.area.top-bodyRect.top)+'px'
        , left: (cursorBroadcastState.area.left-bodyRect.left)+'px'
        , width: cursorBroadcastState.area.width+'px'
        , height: cursorBroadcastState.area.height+'px'
        }
      },
      // Visualize cursors by drawing a line for each author
      Object.keys(cursorBroadcastState.cursors)
      .filter(function(authorId) {return !!state.presence.users[authorId]}) // only users that are present
      .filter(function(authorId) {return authorId !== state.session.user.id}) // not me
      .map(function(authorId) {
        var user = state.presence.users[authorId]
          , cursors = state.cursorBroadcastCkeditor.cursors[authorId]
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
      Object.keys(cursorBroadcastState.cursors)
      .filter(function(authorId) {return !!state.presence.users[authorId]}) // only users that are present
      .filter(function(authorId) {return authorId !== state.session.user.id}) // not me
      .map(function(authorId) {
        var cursor = cursorBroadcastState.cursors[authorId][0]
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
        top: (cursorBroadcastState.area.scrollHeight+100)+'px' // +100 because there might be some margin or sth, better safe than sorry...
      }})
      )

    )
  }

  register(null, {cursorBroadcastCkeditor: cursorBroadcast})
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
