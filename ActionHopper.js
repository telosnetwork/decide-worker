module.exports = class ActionHopper {

	constructor(signer, api) {
		this.hopper = [];
		this.signer = signer;
		this.permission = 'active';
		this.api = api;
		//TODO: this.cosign = true; //esr mode
		//TODO: this.energyProvider = 'https://energy.dappetizer.io/esr=...';
	}

	//return contents of hopper
	getHopper() {
		return this.hopper;
	}

	//return signing account
	getSigner() {
		return this.signer;
	}

	//return signing permission
	getPermission() {
		return this.permission;
	}

	//load an action into the hopper
	load(action) {
		this.hopper.push(action);
	}

	//load an action into the front of the hopper
	frontload(action) {
		this.hopper.unshift(action);
	}

	//TODO: filter hopper for cosign auth
	filter() {
		let temp_hopper = this.hopper;
		// temp_hopper.forEach(element => {

		// });
	}

	//view the actions loaded in hopper
	view() {
		console.log(this.hopper);
	}

	//clear the hopper
	clear() {
		this.hopper = [];
	}

	//TODO: push cosigned trx to cosigner
	transport() {

	}

	//cosign a transaction
	async cosign() {

		const res = await this.api.transact({
			actions: this.getHopper()
		}, {
			broadcast: false,
			sign: true,
			blocksBehind: 3,
			expireSeconds: 30,
		});

		console.log(res);

	}

	//sign and broadcast contents of hopper
	async fire() {
		console.log("Firing");
		let actions = this.getHopper();
		this.clear();
		const res = await this.api.transact({
			actions
		}, {
			broadcast: true,
			sign: true,
			blocksBehind: 3,
			expireSeconds: 30,
		});

		//if trx executed
		if (res.processed.receipt.status == 'executed') {
			console.log('Transaction Executed:', res.transaction_id);
		} else {
			//TODO: report error
			this.actions = actions;
			console.log('Transaction Error');
		}
	}

};
