const SHA256 = require('crypto-js/sha256');
const { hasSubscribers } = require('diagnostics_channel');
const fs = require('fs');
const redis = require('redis');

// Create the MinerPub and MinerSub channels that all mining instances should publish/subscribe to
const minerPublisher = redis.createClient();
const minerSubscriber = redis.createClient();

// Create a separate setupSub channel for initializing the blockchain when a miner starts up
const setupSubscriber = redis.createClient();

const TARGET_DIFFICULTY = BigInt(0x000fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff);
const MAX_TRANSACTIONS = 10;
const MINER_CHANNEL = "miner-notify"
const SETUP_CHANNEL = "setup-notify"

class MemPool {
    constructor() {
        // TODO: instatiate a local redis instance to store transactions, subscribe to a websocket
        //       that will be filled by clients requesting transactions
        // for now just make an empty list
        this.transactionPool = [];
    }

    addTransaction(transaction) {
        // TODO: add transaction to mempool by pushing it to redis instance
        this.transactionPool.push(transaction);
    }

    removeTransaction() {
        if (this.transactionPool) {
            // TODO: remove transaction from mempool by pulling it from redis instance
            return this.transactionPool.pop();
        }

        return null;
    }
}

class Block {
    constructor() {
        this.timestamp = Date.now();
        this.nonce = 0;
        this.transactions = [];
        this.prevHash = 0;
    }

    addTransaction(tx) {
        if (this.transactions.length < MAX_TRANSACTIONS) {
            this.transactions.push(tx);
        }
    }

    hash() {
        return SHA256(
            this.timestamp + "" +
            this.nonce + "" +
            JSON.stringify(this.transactions)
        ).toString();
    }

    execute() {
        // TODO: add-on, may implement if I get far enough to warrant U/TXOs
        // something lke: this.transactions.forEach(x => x.execute()); assuming what gets pushed
        // to transactions is a Transaction class instance
    }
}

class Chain {
    constructor(file) {
        this.blockChainFile = file;
        this.blocks = this.getCurrentChain();
    }

    getCurrentChain() {
        // Fire off a request to the MINER_CHANNEL for a copy of the most up-to-date blockchain
        minerPublisher.publish(MINER_CHANNEL, "request-chain");

        try {
            let initChain = fs.readFileSync(this.blockChainFile);
            return JSON.parse(initChain);
        }
        catch {
            return [];
        }
    }

    addBlock(block) {
        this.blocks.push(block);
    }

    blockHeight() {
        return this.blocks.length;
    }
}

const handler = () => new Promise((res) => {
    setTimeout(res, 0);
});

class Miner {
    constructor(address, chainFile) {
        this.address = address; // address is the pubkey of the miner
        this.chainFile = chainFile
        this.blockToMine = null; // this where the new block to be mined will be stored
        this.blockChain = new Chain(this.chainFile); // instantiate the blockchain for this miner
        this.mempool = new MemPool(); // instatiate the mempool for this miner
    }

    async startMining() {
        // Attempt to mine for blocks while simultaneously checking for any new blocks that may
        // have been mined somewhere else via the websocket and checking to see if any new
        // transactions have been requested

        while(true) {
            // Infinite mining!
            await handler();
            this.blockToMine = new Block();

            // Set the prevHash for the new block
            let chainHeight = this.blockChain.blockHeight();
            if (chainHeight !== 0) {
                this.blockToMine.prevHash = this.blockChain.blocks[chainHeight - 1].blockHash;
            }

            // Add the initial reward transaction for mining the block
            this.blockToMine.addTransaction({address: this.address, amount: '6.25'});

            // TODO: need to also subscribe to the client websocket to make sure any new transactions
            //       requested by a client get added to the mempool
            for (let i = 1; i < MAX_TRANSACTIONS; i++) {
                let transaction = this.mempool.removeTransaction();

                if (transaction) {
                    this.blockToMine.addTransaction(transaction);
                }
                else {
                    break;
                }
            }

            // TODO: if at _any_ point during this inner loop a new transaction appears, need to
            //       put all the transactions back in to the mempool and start the inner loop
            //       again so the new transaction will get added to the block

            let newBlockHash = this.blockToMine.hash();
            while (BigInt(`0x${newBlockHash}`) > TARGET_DIFFICULTY) {
                await handler();
                this.blockToMine.nonce += 1;
                newBlockHash = this.blockToMine.hash();
            }

            this.blockToMine.blockHash = newBlockHash;
            this.blockChain.addBlock(this.blockToMine);
            console.log(`Added new block ${JSON.stringify(this.blockToMine)} to the blockchain`)
            //minerPublisher.publish(MINER_CHANNEL, JSON.stringify(this.blockToMine));
        }
    }

    stopMining() {
        // Save blockchain state to JSON file to pick back up from where the miner left off
        console.log(`Stopping mining process, writing blockchain state to: ${this.chainFile}`);
        fs.writeFileSync(this.chainFile, JSON.stringify(this.blockChain.blocks));
    }
}

async function initializeMiner(cliArgs) {
    console.log(cliArgs);
    miningInstance = new Miner(cliArgs[2], cliArgs[3]);
    console.log(JSON.stringify(miningInstance));

    miningInstance.startMining();
}

// main
let miningInstance = null;

minerSubscriber.on("message", (channel, message) => {
    if (channel !== SETUP_CHANNEL) {
        console.log(`Received message ${message} from channel ${channel}`);
        // depending on the message received, the miner may need to respond with
        // data or update their own data i.e. if a miner is requesting the current blockchain then
        // the miner nneds to respond back with the blockchain and if a miner publishes a new block
        // then the other miners need to add the new block to their blockchains and restart
        // their mining loop

        if (message === "request-chain") {
            minerPublisher.publish(SETUP_CHANNEL, JSON.stringify(miningInstance.blockChain.blocks));
        }
    }
});

setupSubscriber.on("message", (channel, message) => {
    // TODO: assume that whatever message is received is the most current blockchain,
    //       need to check and make sure that the blockchain the miner has is equivalent
    //       to the one received here
    console.log(`Received message ${message} from channel ${channel}`);
    setupSubscriber.unsubscribe(SETUP_CHANNEL);
    setupSubscriber.quit();
})

minerSubscriber.subscribe(MINER_CHANNEL);
setupSubscriber.subscribe(SETUP_CHANNEL);

process.on('SIGINT', () => {
    console.log("\nCTRL-C detected, exiting")
    miningInstance.stopMining();
    process.exit();
})

initializeMiner(process.argv);
// end main

module.exports = {
    TARGET_DIFFICULTY,
    MAX_TRANSACTIONS,
    MemPool,
    Block,
    Chain,
    Miner,
};