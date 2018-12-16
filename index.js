import WebSocket from 'ws'
import http from 'http'
import url from 'url'
import Mongo from './mongo'

const mongoUrl = 'mongodb://127.0.0.1:27017'
const dbName = 'eosstats'
const seconds = 1000

const mongo = new Mongo(mongoUrl, dbName)

// define some normal http functions
const server = http.createServer((req, res) => {
  const pathname = url.parse(req.url).pathname;
  
  if(pathname == '/utilization') {
    return utilization_action(req, res)
  } else if (pathname == '/ops') {
    return ops_action(req, res)
  } else {
    res.writeHead(404, {"Content-Type": "text/plain"})
    res.write("404 Not Found\n")
    res.end()
  }
})

server.listen(9090, "127.0.0.1")

// define some websocket functions
const wss_live = new WebSocket.Server({ noServer: true });
const wss_stream = new WebSocket.Server({ noServer: true });
server.on('upgrade', (request, socket, head) => {
  const pathname = url.parse(request.url).pathname

  if (pathname === '/live') {
    wss_live.handleUpgrade(request, socket, head, (ws) => {
      wss_live.emit('connection', ws);
    });
  } else if (pathname === '/stream') {
    wss_stream.handleUpgrade(request, socket, head, (ws) => {
      wss_stream.emit('connection', ws);
    });
  } else {
    socket.destroy();
  }
});


async function get_latest_blocks(limit, projection={}) {
  const db = await mongo.db()
  return db.collection('s').find().project(projection).sort({block_num: -1}).limit(limit).toArray()
}

async function get_latest_block(projection={}) {
  const res = await get_latest_blocks(1, projection)
  return res[0]
}

async function notify(fun) {
  const block_info = await get_latest_block()
  const aps = block_info.actions * 2
  const tps = block_info.transactions * 2
  fun([aps, tps])
  setTimeout(notify, 500, fun);  
}

notify(([aps, tps]) => {
  broadcast(wss_live, JSON.stringify({aps, tps}))
})

function broadcast(socket, data) {
  socket.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data)
    }
  })
}

function sum(list) {
  return list.reduce((a, b) => a + b)
}

function mean(list) {
  return sum(list)/list.length
}

var utilization_list =[]
var mean_usage
async function get_utilization() {
  const block_cpu_limit = 200000
  const blocks = await get_latest_blocks(600, {cpu_usage_us: 1, _id: 0})
  const usage = blocks.map(x => x.cpu_usage_us)
  return mean(usage)
}

async function utilization_action(req, res) {
  const mean_usage = await get_utilization()
  res.writeHead(200, {"Content-Type": "text/plain"})
  res.write( String((mean_usage*100).toFixed(1)) + "%")
  res.end()
}


async function ops_action(req, res) {
  const db = await mongo.db()
  const x = await db.collection('g').findOne()
  res.writeHead(200, {"Content-Type": "text/plain"})
  res.write( String(x.actions) )
  res.end()
}


