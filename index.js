import MongoClient from 'mongodb'
import Promise from 'bluebird'
global.Promise = Promise
import WebSocket from 'ws'
import http from 'http'
import url from 'url'
import Eos from 'eosjs-api'

const httpEndpoint = 'https://proxy.eosnode.tools';
const chainId = 'aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906';

const eos = Eos({httpEndpoint, chainId})

const mongoUrl = 'mongodb://127.0.0.1:27017'
const dbName = 'EOS'
const seconds = 1000

const sample_frequency = seconds
const sample_multiplier = seconds/sample_frequency

// const server = http.createServer()
// server.listen(9090);
// 
// const wss_live = new WebSocket.Server({server: server, path: '/live' });
// // const wss_stream = new WebSocket.Server({server: server, path: '/stream' });


// define some normal http functions
const server = http.createServer((req, res) => {
  const pathname = url.parse(req.url).pathname;
  
  if(pathname == '/utilization') {
    return utilization_action(req, res)
  } else if (pathname == '/ops') {
    return ops_action(req, res)
  } else if (pathname == '/max_ops') {
    return max_ops_action(req, res)
  } else {
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




function getMongoConnection(url) {
  return MongoClient.connect(url, { 
		promiseLibrary: Promise, 
		useNewUrlParser: true,
	})
  .disposer(conn => conn.close())
}

export function mongo(fun) {
  return Promise.using(getMongoConnection(mongoUrl), fun)
}

function get_count(collection) {
  return mongo(conn => {
      return conn.db(dbName).collection(collection)
        .estimatedDocumentCount()
  }).then(count => {
    // console.log("Transactions: ", count)
    return count
  })
}

function get_actions() {
  return get_count('action_traces')
}

function get_transactions() {
  return get_count('transaction_traces')
}

function add(list, element, max_items=1) {
  // console.log("List: ", JSON.stringify(list))
  list.push(element)
  while(list.length > max_items) {
    list.shift()
  }
}

function sum(list) {
  return list.reduce((a, b) => a + b)
}

function mean(list) {
  return sum(list)/list.length
}


var last_actions, last_transactions;
var queue_aps = [], queue_tps = [];
function notify(fun) {
  Promise.all([
    get_actions(),
    get_transactions(),
  ])
  .then(([actions, transactions]) => {
    if(typeof last_actions == 'undefined') last_actions = actions
    if(typeof last_transactions == 'undefined') last_transactions = transactions
    // console.log("ohai actions: ", actions)
    // console.log("ohai transactions: ", transactions)
    const current_aps = (actions-last_actions)*sample_multiplier
    const current_tps = (transactions-last_transactions)*sample_multiplier
    // console.log("current_aps: ", current_aps)
    // console.log("current_tps: ", current_tps)
    add(queue_aps, current_aps)
    add(queue_tps, current_tps)
    const mean_aps = mean(queue_aps)
    const mean_tps = mean(queue_tps)
    // console.log("mean_aps: ", mean_aps)
    fun([mean_aps, mean_tps])
    last_actions = actions
    last_transactions = transactions
    setTimeout(notify, sample_frequency, fun);  
  })
}

var global_aps, global_tps

notify(([aps, tps]) => {
  global_aps = aps
  global_tps = tps
  // console.log("Notify aps: ", aps)
  // console.log("Notify tps: ", tps)
  broadcast(wss_live, JSON.stringify({
    aps: aps,
    tps: tps,
  }))
})

function broadcast(socket, data) {
  socket.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data)
    }
  })
}

// STREAM STUFF

var last_known_sequence;
function get_current_sequence() {
  if(typeof last_known_sequence != 'undefined') {
    return new Promise(function (resolve, reject) {
      resolve(last_known_sequence)
    })
  } else {
    return mongo(conn => {
      return conn.db(dbName).collection('action_traces')
        .find({}, {projection: {"receipt.global_sequence": 1}})
        .sort({"receipt.global_sequence": -1}).limit(1)
        .toArray()
    }).then(items => {
      last_known_sequence = items[0].receipt.global_sequence
      return last_known_sequence
    })
  }
}

function get_actions_stream(start) {
  return mongo(conn => {
    return conn.db(dbName).collection('action_traces')
      .find({"receipt.global_sequence" : { $gt: start }})
      .sort({"receipt.global_sequence": 1})
      .toArray()
  }).then(items => {
    return items
  })
}

function format_action(action) {
  return `${action.receipt.global_sequence} ${action.act.account} ${action.act.name}`
}

function stream() {
  get_current_sequence()
  .then(start => {
    // console.log("Start: ", start)
    get_actions_stream(start)
    .then(items => {
      if(items.length) {
        console.log(items.map(x => format_action(x)))
        broadcast(wss_stream, JSON.stringify(items))
        const latest = items[items.length-1].receipt.global_sequence
        // console.log("Latest: ", latest)
        last_known_sequence = latest
      }
      setTimeout(stream, 100)
    })
  })

}
// stream()


var utilization_list =[]
var mean_usage
function utilization() {
  eos.getInfo({})
  .then(info => {
    const block_num = info.last_irreversible_block_num
    // console.log(block_num)
    eos.getBlock(block_num)
    .then(x => {
      const cpu_usage = sum(x.transactions.map(x => x.cpu_usage_us))
      // console.log(cpu_usage)
      const usage = cpu_usage/info.block_cpu_limit
      // console.log("Usage: ", usage)
      if(usage <= 1) {
        add(utilization_list, usage, 300)
        mean_usage = mean(utilization_list)
        // console.log("Mean Usage: ", mean_usage)
      }
      setTimeout(utilization, 1000)
    })
  }).timeout(3000, "Timeout")
  .catch(e => {
    console.log(e)
    setTimeout(utilization, 3000)
  })
}

utilization()

function utilization_action(req, res) {
  res.write( String((mean_usage*100).toFixed(1)) + "%")
  res.end()
}


function ops_action(req, res) {
  get_actions()
  .then(count => {
    res.write( String(count) )
    res.end()
  })
}


function max_ops_action(req, res) {
  const max_ops = global_aps/mean_usage
  res.write( String(max_ops) )
  res.end()
}
