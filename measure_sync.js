const Eos = require('eosjs-api')

var httpEndpoint;
if(process.argv[2]) {
  httpEndpoint = process.argv[2]
} else {
  httpEndpoint = 'http://95.216.38.17:8888';  
} 
const chainId = 'aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906';

const eos = Eos({httpEndpoint, chainId})

const seconds = 1000
const minutes = 60*seconds
const interval = 5*minutes

var a, b;
function doit() {  
  eos.getInfo({})
  .then(info => {
    b = new Date(info.head_block_time)
    if(a) {
      console.log("Speedup factor: ", (b-a)/interval)
    } 
    a = b
    setTimeout(doit, interval)
  })
}

doit()