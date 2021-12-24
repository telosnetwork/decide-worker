//env
require('dotenv').config();

//db
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const adapter = new FileSync('db.json');
const db = low(adapter);

//authority provider
const CosignAuthorityProvider = require('./CosignAuthorityProvider');

//eosjs
const { Api, JsonRpc, RpcError } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig'); //development only
const fetch = require('node-fetch'); //node only; not needed in browsers
const { TextEncoder, TextDecoder } = require('util'); //node only; native TextEncoder/Decoder
const defaultPrivateKey = process.env.WORKER_PRIV_KEY;
const signatureProvider = new JsSignatureProvider([defaultPrivateKey]);
const rpc = new JsonRpc(process.env.RPC_ENDPOINT, { fetch });
const api = new Api({ rpc, authorityProvider: new CosignAuthorityProvider(rpc), signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });

//action hopper
const ActionHopper = require('./ActionHopper');
const hopper = new ActionHopper(process.env.WORKER_ACCT_NAME, api);

//hyperion
const HyperionSocketClient = require('@eosrio/hyperion-stream-client').default;
const client = new HyperionSocketClient(process.env.HYPERION_ENDPOINT, { async: true });
const moment = require('moment');

//define db
const dbSchema = {
	config: {
		worker_account: process.env.WORKER_ACCT_NAME,
		pub_key: process.env.WORKER_PUB_KEY
	},
	ballots: [],
	watchlist: []
};

//set db defaults
db.defaults(dbSchema)
	.write()

syncBallots = async () => {
	//TODO: get ballots by end time instead
	const res = await rpc.get_table_rows({
		json: true,
		code: process.env.GOV_ENGINE_ACCT,
		scope: process.env.GOV_ENGINE_ACCT,
		table: 'ballots',
		limit: 1000,
		reverse: true,
		show_payer: false
	});

	//initialize
	const newBallotsList = [];

	//loop over each ballot returned from query
	res.rows.forEach(element => {
		//if symbol is 4,VOTE and status is voting
		if (element.treasury_symbol == '4,VOTE' && element.status == 'voting') {
			//define new ballot
			const newBallot = {
				ballot_name: element.ballot_name,
				end_time: element.end_time
			};

			//push new ballot into list
			newBallotsList.push(newBallot);
		}
	})
	console.dir(newBallotsList);

	//write ballots list to db
	db.set('ballots', newBallotsList)
		.write()

	console.log('Ballots Synced');
}

syncVotes = async () => {
	var ballotMap = {};
	//get ballots from db
	let bals = db.get('ballots')
		.value();

	//sync votes for each ballot in db
	await Promise.all(bals.map(async (element) => {
		let ballotVoters = new Set();
		//query for votes on ballot
		const res = await rpc.get_table_rows({
			json: true,
			code: process.env.GOV_ENGINE_ACCT,
			scope: element.ballot_name,
			table: 'votes',
			limit: 10000,
			reverse: true,
			show_payer: false
		});

		//save votes to watchlist
		res.rows.forEach(vote => {
			ballotVoters.add(vote.voter);
			//check db for account in watchlist
			const res2 = db.get('watchlist')
				.find({ account_name: vote.voter })
				.size()
				.value()
			//console.log(`${res2 == 0 ? "New" : "Existing"} Account: ${vote.voter} with res2: ${res2}`);

			//if account not in watchlist
			if (res2 == 0) {
				//define new voter
				const new_voter = {
					account_name: vote.voter,
					votes: [
						{
							ballot_name: element.ballot_name
						}
					]
				};

				//write new voter to watchlist
				db.get('watchlist')
					.push(new_voter)
					.write()
			} else { //account found in watchlist
				//check db for existing vote
				const res3 = db.get('watchlist')
					.find({ account_name: vote.voter })
					.get('votes')
					.find({ ballot_name: element.ballot_name })
					.size()
					.value()

				//if existing vote not found in db
				if (res3 == 0) {
					// console.log(`adding vote from ${vote.voter} to ${element.ballot_name}`)

					//define new vote
					const new_vote = {
						ballot_name: element.ballot_name
					};

					//add vote to watchlist
					db.get('watchlist')
						.find({ account_name: vote.voter })
						.get('votes')
						.push(new_vote)
						.write()
				}
			}
		})
		console.log("Adding " + element.ballot_name + " with value: " + ballotVoters);
		ballotMap[element.ballot_name] = ballotVoters;
	}))

	console.log('Votes Synced')
	console.log("BallotMap: ");
	console.dir(ballotMap);
	return ballotMap;
}

rebalanceAll = async (ballotMap) => {
	const conf = db.get('config')
		.value();
	console.log("JESSE: ");
	console.dir(ballotMap);
	for (let ballotName in ballotMap) {
		for (const voterAccount of ballotMap[ballotName]) {
			console.log(`${ballotName} :: ${voterAccount}`);
			let rebal_action = {
				account: 'telos.decide',
				name: 'rebalance',
				authorization: [
					{
						actor: conf.worker_account,
						permission: 'active',
					}
				],
				data: {
					voter: voterAccount,
					ballot_name: ballotName,
					worker: conf.worker_account
				}
			}
			//push action to hopper
			hopper.load(rebal_action);
			try {
				await hopper.fire();
			} catch (e) {
				if (e.message.endsWith("vote has already expired"))
					hopper.clear();
				else
					console.log("ERROR: " + e.message);
			}
		}

	}
}

startFrom = 0;
startup = async () => {
	console.log("Starting up...");
	if (process.env.SYNC_ON_STARTUP) {
		startFrom = moment
			.utc()
			.subtract(30, "days")
			.format("YYYY-MM-DDTHH:mm:ss.SSS[Z]");
		await syncBallots();
		let ballotMap = await syncVotes();
		rebalanceAll(ballotMap);

	}
}

//define streams to watch
client.onConnect = () => {

	//openvoting action stream
	client.streamActions({
		contract: process.env.GOV_ENGINE_ACCT,
		action: 'openvoting',
		account: '',
		start_from: startFrom,
		read_until: 0,
		filters: [],
	});

	//closevoting action stream
	// client.streamActions({
	//     contract: 'telos.decide',
	//     action: 'closevoting',
	//     account: '',
	//     start_from: 0,
	//     read_until: 0,
	//     filters: [],
	// });

	//TODO: cancelballot action stream

	//castvote action stream
	client.streamActions({
		contract: 'telos.decide',
		action: 'castvote',
		account: '',
		start_from: startFrom,
		read_until: 0,
		filters: [],
	});

	//voters table delta stream
	client.streamDeltas({
		code: 'telos.decide',
		table: 'voters',
		scope: '*',
		payer: '',
		start_from: startFrom,
		read_until: 0,
	});

}

//handle stream data
client.onData = async (data, ack) => {

	//if action stream
	if (data.type == 'action') {
		//console.log('>>> Action Received:');

		//initialize
		const actionName = data.content.act.name;

		//perform task based on action name
		switch (actionName) {
			case 'openvoting':
				//TASK: add ballot to ballots list in db

				//validate
				//TODO: check ballot is VOTE

				//define new ballot
				const newBallot = {
					ballot_name: data.content.act.data.ballot_name,
					end_time: data.content.act.data.end_time
				};

				//write new ballot
				db.get('ballots')
					.push(newBallot)
					.write()

				console.log('Ballot added to list');

				break;
			case 'closevoting':
				//TASK: remove ballot from ballots list in db

				//validate
				//TODO: check ballot is VOTE

				//remove ballot from list
				db.get('ballots')
					.remove({ ballot_name: data.content.act.ballot_name })
					.write()

				console.log('Ballot removed from list');

				break;
			case 'castvote':
				//TASK: add vote to watchlist if not exists

				//initialize
				const voter = data.content.act.data.voter;
				const ballot = data.content.act.data.ballot_name;

				//validate
				//TODO: check ballot is VOTE from db

				//check for existing voter on watchlist
				const res = db.get('watchlist')
					.find({ account_name: voter })
					.size()
					.value()

				//if account found on watchlist
				if (res != 0) {

					//check for existing vote
					const res2 = db.get('watchlist')
						.find({ account_name: voter })
						.get('votes')
						.find({ ballot_name: ballot })
						.size()
						.value()

					//if vote not found
					if (res2 == 0) {

						//define new vote
						const new_vote = {
							ballot_name: ballot
						};

						//add vote to watchlist
						db.get('watchlist')
							.find({ account_name: voter })
							.get('votes')
							.push(new_vote)
							.write()

						console.log('Vote added to account');

					} else { //if vote found

						//console.log('Vote Found. Skipping.');

						//TODO: check ballot status. if ended, remove ballot.

					}

				} else { //if account not found on watchlist

					//define new voter
					const new_voter = {
						account_name: voter,
						votes: [
							{
								ballot_name: ballot
							}
						]
					};

					//write new voter to watchlist
					db.get('watchlist')
						.push(new_voter)
						.write()

					console.log('Account added to watchlist');

				}

				break;
			default:
				console.error('Action Not Found', actionName);
		}

	}

	//if delta stream
	if (data.type == 'delta') {
		// console.log('>>> Table Delta Received: ');

		//initialize
		const voterAccount = data.content.scope;
		let didFilter = false;
		let filteredVotes = [];

		//get config info
		const conf = db.get('config')
			.value()

		//get account's vote list
		const votesList = db.get('watchlist')
			.find({ account_name: voterAccount })
			.get('votes')
			.value()

		//if account not found
		if (votesList == undefined) {
			console.log(`Account Not Found ${voterAccount}`);
		} else {
			//filter each vote on account
			votesList.forEach(element => {
				//get ballot from db
				const ballotQuery = db.get('ballots')
					.find({ ballot_name: element.ballot_name })
					.value()

				//if ballot found
				if (ballotQuery != undefined) {
					//if ballot still active
					if (Date.now() < Date.parse(ballotQuery.end_time)) {
						//define vote
						const newVote = {
							ballot_name: element.ballot_name
						};
						//add to filtered votes
						filteredVotes.push(newVote);
					} else {
						didFilter = true;
					}
				} else { //ballot not found
					//TODO: fetch ballot from chain and add to db
				}
			});
		}

		//--------------------------------------

		//load action hopper
		let seen = []
		filteredVotes.forEach(element => {
			//define rebal action
			let seenId = voterAccount + "::" + element.ballot_name;
			console.log(seenId);
			if (!seen.includes(seenId)) {
				seen.push(seenId);
				let rebal_action = {
					account: 'telos.decide',
					name: 'rebalance',
					authorization: [
						{
							actor: conf.worker_account,
							permission: 'active',
						}
					],
					data: {
						voter: voterAccount,
						ballot_name: element.ballot_name,
						worker: conf.worker_account
					}
				}
				//push action to hopper
				hopper.load(rebal_action);
			}
		});

		// const cosign_action = {
		//     account: 'energytester',
		//     name: 'cosign',
		//     authorization: [
		//         {
		//             actor: 'energytester',
		//             permission: 'active',
		//         }
		//     ],
		//     data: {
		//         account_owner: 'decideworker'
		//     }
		// };
		// hopper.frontload(cosign_action);
		// console.log('Cosigning...');
		// hopper.cosign();

		// hopper.view();

		//if hopper not empty
		if (hopper.getHopper().length > 0) {
			//sign and broadcast
			await hopper.fire();
			await new Promise(resolve => setTimeout(resolve, 500));
		}

		//if votes were filtered from vote list
		if (didFilter) {
			//set filteredVotes as new votes
			db.get('watchlist')
				.find({ account_name: voterAccount })
				.set('votes', filteredVotes)
				.write()
		}

	}
	ack();
}

//===== initialize =====

;(async () => {
	await startup();
})()

//connect to stream(s)
client.connect(() => {
	console.log('Worker Node ONLINE');
	console.log('Streaming from', process.env.CHAIN_NAME);
});
