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
  , co = require('co')
  , jsonParse = require('json-stream')
  , through = require('through2')

module.exports = setup
module.exports.consumes = ['ui', 'editor', 'models','hooks', 'presence']
function setup(plugin, imports, register) {
  var ui = imports.ui
  , hooks = imports.hooks
  , Backbone = imports.models.Backbone

  var link = document.createElement('link')
  link.setAttribute('rel', 'stylesheet')
  link.setAttribute('href', ui.baseURL+'/static/hive-plugin-ckeditor-cursor-broadcast/css/index.css')
  document.head.appendChild(link)

  ui.page('/documents/:id', function(ctx, next) {
    // This plugin works with the default html editor only
    if(ctx.document.get('type') !== 'html') return next()

    var cke_inner = document.querySelector('#editor .cke_inner')
      , wysiwyg_frame = document.querySelector('#editor .cke_inner .cke_wysiwyg_frame')
      , tree = h('div.Cursors')
      , container = vdom.create(tree)
      , authors = ctx.presentUsers
      , broadcast = ctx.broadcast.createDuplexStream(new Buffer('cursors'))
      , cursors = {}

    cke_inner.appendChild(container)

    var initialized = false
    broadcast
    .pipe(jsonParse())
    .pipe(through.obj(function(broadcastCursors, enc, cb) {
      for(var userId in broadcastCursors) {
        cursors[userId] = broadcastCursors[userId]
      }
      authors.add(Object.keys(broadcastCursors).map(function(id) {return {id: id}}))
      if(initialized) render(cursors)
      else ctx.editableDocument.on('init', function() {
        setTimeout(function() {
          render(cursors)
        },0)
        initialized = true
      })
      cb()
    }))

    // If the main editor window is scrolled, scroll the cursors, too
    var editorWindow = ctx.editableDocument.rootNode.ownerDocument.defaultView
    editorWindow.addEventListener('scroll', function() {
      container.scrollTop = editorWindow.scrollY
      container.scrollLeft = editorWindow.scrollX
    })

    setInterval(function() {
      var sel = editorWindow.getSelection()
        , range = sel.getRangeAt(0)
        , rootNode = ctx.editableDocument.rootNode
      var obj = {
        start: [pathTo(range.startContainer, rootNode), range.startOffset]
      , end: [pathTo(range.endContainer, rootNode), range.endOffset]
      }
      broadcast.write(JSON.stringify(obj)+'\n')
    }, 1000)

    // If a color changes, re-render!
    authors.on('change:color', function(){
      render(cursors)
    })

    function render(cursors) {
      try {
        cursors = pathsToCoordinates(cursors, ctx.editableDocument.rootNode, editorWindow)
        var rect = wysiwyg_frame.getBoundingClientRect()
        var newtree = h('div.Cursors', {style: {
            // Position container directly above the editing window
              top: (rect.top+window.scrollY)+'px'
            , left: (rect.left+window.scrollX)+'px'
            , width: rect.width+'px'
            , height: rect.height+'px'
            }
          },
          // Visualize cursors by drawing a line for each author
          Object.keys(cursors)
          .filter(function(authorId) {return !!authors.get(authorId)}) // only present users
          .filter(function(authorId) {return authorId !== ctx.user.get('id')}) // not me
          .map(function(author) {
            return h('div.Cursors__Cursor', {
                attributes:{ title: authors.get(author).get('name')}
              , style: {
                    'border-color': authors.get(author).get('color') || '#777'
                  , 'left': cursors[author].x+'px'
                  , 'top': cursors[author].y+'px'
                  , 'width': cursors[author].width+'px'
                  , 'height': cursors[author].height+'px'
                  }
                })
          })
          .concat(
          // Display the authors name alongside their cursor
          Object.keys(cursors)
          .filter(function(authorId) {return !!authors.get(authorId)}) // only present users
          .filter(function(authorId) {return authorId !== ctx.user.get('id')}) // not me
          .map(function(author) {
            return h('div.Cursors__Label', {
              style: {
                  'left': cursors[author].x+'px'
                , 'top': 'calc('+cursors[author].y+'px - .4cm)'
                }
              }, authors.get(author).get('name'))
          })
          )
          .concat(
          // Scroll fix! To ensure scrollability we add an empty cursor right at teh end of the document
          h('div.Cursors__Cursor', {style: {
            top: ctx.editableDocument.rootNode.clientHeight+'px'
          }})
          )

        )

        // Construct the diff between the new and the old drawing and update the live dom tree
        var patches = vdom.diff(tree, newtree)
        vdom.patch(container, patches)
        tree = newtree
        container.scrollTop = editorWindow.scrollY
        container.scrollLeft = editorWindow.scrollX
      }catch(e) {
        console.log(e)
      }
    }

    next()
  })

  register()
}

function pathsToCoordinates(cursors, rootNode, editorWindow) {
  var coordinates = {}
  Object.keys(cursors).forEach(function(userId) {
    var range = document.createRange()
    range.setStart(nodeAt(cursors[userId].start[0], rootNode), cursors[userId].start[1])
    range.setEnd(nodeAt(cursors[userId].end[0], rootNode), cursors[userId].end[1])
    var rect = range.getBoundingClientRect()
    coordinates[userId] = {
      x: rect.left+editorWindow.scrollX
    , y: rect.top+editorWindow.scrollY
    , width: rect.width
    , height: rect.height
    }
  })
  return coordinates
}
