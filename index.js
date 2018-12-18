import WebSocket from 'ws'
import http from 'http'
import url from 'url'
import Mongo from './mongo'
import Promise from 'bluebird'
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
const wss = new WebSocket.Server({ noServer: true });
server.on('upgrade', (request, socket, head) => {
  const pathname = url.parse(request.url).pathname

  if (pathname === '/live') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws);
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

async function get_max_aps_block() {
  const db = await mongo.db()
  const res = await db.collection('s').find().sort({actions: -1, block_num: 1}).limit(1).toArray()
  return res[0]
}

async function get_max_tps_block() {
  const db = await mongo.db()
  const res = await db.collection('s').find().sort({transactions: -1, block_num: 1}).limit(1).toArray()
  return res[0]
}

async function get_stream_data() {
  const block_info = await get_latest_block()
  const current_aps = block_info.actions * 2
  const current_tps = block_info.transactions * 2
  const current_block = block_info.block_num
  const max_aps_block_info = await get_max_aps_block()
  const max_tps_block_info = await get_max_tps_block()
  const max_tps_block = max_tps_block_info.block_num
  const max_aps_block = max_aps_block_info.block_num
  const max_aps = max_aps_block_info.actions * 2
  const max_tps = max_tps_block_info.transactions * 2
  /*
  Max TPS:
  Max TPS Block:

  Max APS: 
  Mas APS Block:

  Current TPS:
  Current TPS Block:

  Current APS: 
  Current APS Block:
  */
  return {
    current_block,
    max_tps,
    max_tps_block,
    max_aps,
    max_aps_block,
    current_tps,
    current_aps,
  }
}

async function livestream() {
  let last_block
  while(true) {
    const data = await get_stream_data()
    console.log("data.current_block: ", data.current_block)
    if(data.current_block != last_block) {
      last_block = data.current_block
      broadcast(wss, JSON.stringify(data))
    }
    await Promise.delay(100)    
  }
}
livestream()

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
  const usage = blocks.map(x => x.cpu_usage_us/block_cpu_limit)
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
  const actions = x.actions - 332964188 // adjust zero point to be compatible with mongodb plugin (with blocktwitter disabled etc.)
  res.writeHead(200, {"Content-Type": "text/plain"})
  res.write( String(actions) )
  res.end()
}


