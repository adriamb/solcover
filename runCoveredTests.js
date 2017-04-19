const Web3 = require('web3');
const shell = require('shelljs');
const SolidityCoder = require('web3/lib/solidity/coder.js');
const getInstrumentedVersion = require('./instrumentSolidity.js');
const fs = require('fs');
const path = require('path');
const CoverageMap = require('./coverageMap.js');
const mkdirp = require('mkdirp');
const childprocess = require('child_process');

const coverage = new CoverageMap();
const web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:8545'));

// Patch our local testrpc if necessary
if (!shell.test('-e', './node_modules/ethereumjs-vm/lib/opFns.js.orig')) {
  console.log('patch local testrpc...');
  shell.exec('patch -b ./node_modules/ethereumjs-vm/lib/opFns.js ./hookIntoEvents.patch');
}
// Run the modified testrpc with large block limit
const testrpcProcess = childprocess.exec('./node_modules/ethereumjs-testrpc/bin/testrpc --gasLimit 0xfffffffffffff --gasPrice 0x1');

if (shell.test('-d', '../originalContracts')) {
  console.log('There is already an "originalContracts" directory in your truffle directory.\n' +
              'This is probably due to a previous solcover failure.\n' +
              'Please make sure the ./contracts/ directory contains your contracts (perhaps by copying them from originalContracts), ' +
              'and then delete the originalContracts directory.');
  process.exit(1);
}

shell.mv('./../contracts/', './../originalContracts/');
shell.mkdir('./../contracts/');
// For each contract in originalContracts, get the instrumented version
shell.ls('./../originalContracts/**/*.sol').forEach(file => {

  const canonicalContractPath = path.resolve(file);
  var contract = fs.readFileSync(canonicalContractPath).toString();
 
  if ( file.match(/\/helpers\//g) === null ) {
    console.log('instrumenting ', canonicalContractPath);
    const instrumentedContractInfo = getInstrumentedVersion(contract, canonicalContractPath);
    contract = instrumentedContractInfo.contract
    coverage.addContract(instrumentedContractInfo, canonicalContractPath);
  }

  mkdirp.sync(path.dirname(canonicalContractPath.replace('originalContracts', 'contracts')));
  fs.writeFileSync(canonicalContractPath.replace('originalContracts', 'contracts'), contract);
});

if (fs.existsSync('./allFiredEvents')) {
  shell.rm('./allFiredEvents'); // Delete previous results
}

if (shell.exec('truffle test --network test').code !== 0) {
  console.log('Tests failed')
  testrpcProcess.kill();
  shell.rm('-rf', './../contracts');
  shell.mv('./../originalContracts', './../contracts');
  process.exit(1);
}
testrpcProcess.kill();

const events = fs.readFileSync('./allFiredEvents').toString().split('\n');
events.pop();
// The pop here isn't a bug - there is an empty line at the end of this file, so we
// don't want to include it as an event.
coverage.generate(events, './../originalContracts/');

fs.writeFileSync('./coverage.json', JSON.stringify(coverage.coverage));

if (shell.exec('./node_modules/istanbul/lib/cli.js report lcov') .code !== 0 ) {
  console.log('Coverage failed')
  shell.rm('-rf', './../contracts');
  shell.mv('./../originalContracts', './../contracts');
  process.exit(1);  
}

shell.rm('-rf', './../contracts');
shell.mv('./../originalContracts', './../contracts');
process.exit(0);
