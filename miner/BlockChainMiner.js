const SHA256 = require('crypto-js/sha256');
const fs = require('fs');
const redis = require('redis');

// Create the MinerPub and MinerSub clients that all mining instances should publish/subscribe to
const minerPublisher = redis.createClient();
const minerSubscriber = redis.createClient();

// Create a separate setupSub client for initializing the blockchain when a miner starts up
const setupSubscriber = redis.createClient();

// Create another pair of pub/sub clients that interact with an actual client
const clientPublisher = redis.createClient();
const clientSubscriber = redis.createClient();

const TARGET_DIFFICULTY = BigInt(0x000fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff);
const MAX_TRANSACTIONS = 10;
const MINER_CHANNEL = "miner-notify"
const SETUP_CHANNEL = "setup-notify"
const CLIENT_CHANNEL = "client-notify"

class MemPool {
    constructor() {
        this.transactionPool = [];
        this.updated = false;
    }

    addTransaction(transaction) {
        this.transactionPool.push(transaction);
    }

    removeTransaction() {
        if (this.transactionPool) {
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
        this.chainUpdated = false;
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

    updateChain(block) {
        // Update blochchain with new chain, set update flag to true so that when execution goes
        // back to mine loop it knows that an async event has occured so it needs to restart
        // its mining process
        const { timestamp, nonce, transactions, prevHash } = block;
        const computedHash = block.blockHash;
        let currBlockHash = 0;

        if (this.blockHeight() !== 0) {
            currBlockHash = this.blocks[this.blockHeight() - 1].blockHash;

            if (BigInt(`0x${currBlockHash}`) === BigInt(`0x${computedHash}`)) {
                // pub/sub broadcasts to every subscriber, which includes the subscriber instance
                // of the miner that published the new block notification, so duplicates are possible
                // just return if the 'new' block is actually this miner's current block
                return;
            }
        }

        let checkBlock = new Block();
        checkBlock.timestamp = timestamp;
        checkBlock.nonce = nonce;
        checkBlock.transactions = transactions;
        checkBlock.prevHash = prevHash;
        let checkBlockHash = checkBlock.hash();

        if (BigInt(`0x${checkBlockHash}`) === BigInt(`0x${computedHash}`)) {
            console.log("Computed hash matches reported block hash");

            if (currBlockHash) {
                if (BigInt(`0x${currBlockHash}`) === BigInt(`0x${block.prevHash}`)) {
                    console.log("Previous block hash of newly mined block matches current block hash");
                    // Now that the new block has been verified, add it to this miner's blockchain
                    this.addBlock(block);
                    this.chainUpdated = true;
                }
            }
            else {
                this.addBlock(block);
                this.chainUpdated = true;
            }
        }
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

            // If at _any_ point during this inner loop a new transaction appears, need to
            // put all the transactions back in to the mempool and start the inner loop
            // again so the new transaction will get added to the block

            let newBlockHash = this.blockToMine.hash();
            while (BigInt(`0x${newBlockHash}`) > TARGET_DIFFICULTY) {
                if (this.blockChain.chainUpdated || this.mempool.updated) {
                    break;
                }

                await handler();
                this.blockToMine.nonce += 1;
                newBlockHash = this.blockToMine.hash();
            }

            if (this.blockChain.chainUpdated) {
                this.repopulateMemPool(this.blockToMine.transactions);
                this.blockChain.chainUpdated = false;
                continue;
            }

            if (this.mempool.updated) {
                this.repopulateMemPool(this.blockToMine.transactions);
                this.mempool.updated = false;
                continue;
            }

            this.blockToMine.blockHash = newBlockHash;
            this.blockChain.addBlock(this.blockToMine);
            console.log(`Added new block ${JSON.stringify(this.blockToMine)} to the blockchain`)
            minerPublisher.publish(MINER_CHANNEL, JSON.stringify(this.blockToMine));
        }
    }

    repopulateMemPool(transactions) {
        for (let i = transactions.length - 1; i > 1; i--) {
            // Why not i > 0? Because the first transaction is always the reward for mining a block,
            // don't want to repeat that one because that transaction only occurs when the block
            // is mined by a particular miner
            this.mempool.addTransaction(transactions.pop());
        }
    }

    stopMining() {
        if (this.chainFile) {
            // Save blockchain state to JSON file to pick back up from where the miner left off
            console.log(`Stopping mining process, writing blockchain state to: ${this.chainFile}`);
            fs.writeFileSync(this.chainFile, JSON.stringify(this.blockChain.blocks));
        }
    }
}

async function initializeMiner(cliArgs) {
    console.log(cliArgs);
    // TODO: if null is provided for the miner address, generate a new pub/private key and use that
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
        else {
            // assume message is a new block, update this miner's blockchain accordingly
            miningInstance.blockChain.updateChain(JSON.parse(message));
        }
    }
});

setupSubscriber.on("message", (channel, message) => {
    console.log(`Received updated chain from channel ${channel}`);
    miningInstance.blockChain.blocks = JSON.parse(message);
    miningInstance.blockChain.chainUpdated = true;
    setupSubscriber.unsubscribe(SETUP_CHANNEL);
    setupSubscriber.quit();
})

clientSubscriber.on("message", (channel, message) => {
    if (channel === CLIENT_CHANNEL) {
        console.log(`Received message ${message} from channel ${channel}`)
        if (message["new-transaction"] !== undefined) {
            // client has sent a new transaction to be added to the blockchain, add the new
            // transaction message to the mempool and set the updated flag to true
            miningInstance.mempool.addTransaction(message["new_transaction"]);
            miningInstance.mempool.updated = true;
        }
        else if (message === "request-chain") {
            clientPublisher.publish(CLIENT_CHANNEL, JSON.stringify(miningInstance.blockChain.blocks));
        }
    }
})

minerSubscriber.subscribe(MINER_CHANNEL);
setupSubscriber.subscribe(SETUP_CHANNEL);
clientSubscriber.subscribe(CLIENT_CHANNEL);

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