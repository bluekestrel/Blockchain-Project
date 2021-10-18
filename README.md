## Blockchain-Project
### What is this project?
Blockchain-Project is a simple Proof-of-Work miner with a UI-based client/server that uses redis-channels for client-miner communication
### How to run the project
1. Install redis-server
2. Run ```redis-server```
3. In a separate terminal run: ```cd miner; node BlockChainMiner.js```
    
    This starts a mining instance which will print out a public/private key pair that can be used to reference the miner's account from the client UI

4. In another separate terminal, run: ```cd server; node index.js```

    This starts the backend for the client, which will communicate with the miners

5. In yet another separate terminal, run: ```cd client; npx parcel index.html```

    This starts the client UI, which you can use to view account balances and send transactions

6. CTRL-C can be used to stop any component of this project (server, client, or miner)

### Infrastructure Overview
- Each miner instance is able to communicate with one another via pub/sub using redis channels as the intermediary
- Each client instance is able to communicate with the miners in the same way that the miners communicate with each other
- Whenever a new miner or client spins up, it requests a copy of the most recent blockchain so it can 'catch-up'
- This means that as long as a new instance of a miner or client is able to connect to the active redis-server, any number of miners/clients can be spun-up