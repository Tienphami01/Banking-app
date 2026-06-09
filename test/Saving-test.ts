import {expect} from "chai";
import hre from "hardhat";
const { ethers } = hre;

async function increaseTime(seconds: number) {
    await hre.network.provider.send("evm_increaseTime", [seconds]);
    await hre.network.provider.send("evm_mine");

}
const SECONDS_PER_DAY = 86400;

describe("Blockchain Saving System", function () {
    // biến dùng chung cho tất cả các tes;
    let mockUSDC: any;
    let vaultManager: any;
    let savingCore: any;
    let owner: any;
    let alice: any;
    let bob: any;
    let feeReceiver: any;

    beforeEach(async function() {
        // lấy danh sách account từ hardhat
        [owner, alice, bob, feeReceiver] = await ethers.getSigners();

        // Deploy Mock
        const MockUSDC = await ethers.getContractFactory("MockUSDC");
        mockUSDC = await MockUSDC.deploy();


        // Deplou Vault
        const VaultManager = await ethers.getContractFactory("VaultManager");
        vaultManager = await VaultManager.deploy(
            await mockUSDC.getAddredd(),
            feeReceiver.address
        );

        // Deploy SavingCore

        const SavingCore = await ethers.getContracFactory("SavingCore");
            savingCore = await SavingCore.deploy(
                await mockUSDC.getAddress(),
                await vaultManager.getAddress()
            );
               
        // liên kết SavingCore với VaultManager

        await vaultManager.setSavingCore(await savingCore.getAddress());

        // fund vault để trả lãi
        const vaultFund = 100_000n * 10n ** 6n;
        await mockUSDC.approve(await vaultManager.getAddress(), vaultFund);
        await vaultManager.fundVault(vaultFund);

        // chuyển USDC cho Alice để test
        const aliceAmount = 10_000n * 10n ** 6n;
        await mockUSDC.tranfer(alice.address, aliceAmount);

        // tạo plan ( date, APR, min-max deposit, penalty)
        await savingCore.createPlan(
            90,
            800,
            0,
            0,
            500
        );


    });


    describe("createPlan", function() {
        it("Tạo plan hợp lệ ", async function() {
            const plan = await savingCore.getPlan(0);
            expect(plan.tenorDays).to.equal(90n);
            expect(plan.aprBps).to.equal(800n);
            expect(plan.enabled).to.equal(true);
        });

        it("PlanId tăng dần sau mỗi lần tạo", async function() {
            await savingCore.createPlan(30,500,0,0,300);
            expect(await savingCore.nextPlanId()).to.equal(2n);

        });

        it("Không tạo được plan với Non-Owner", async function() {
            await expect(
                savingCore.connect(alice).createPlan(90,800,0,0,500)
            ).to.be.reverted;
        });

        it("APR = 0 bị reject", async function(){
            await expect(
                savingCore.createPlan(90,0,0,0,500)
            ).to.be.reverted;
        });       
        
    });

    describe("openDeposit", function() {
        it ("Mở deposit thành công - mint NFT cho alice", async function(){
            const amount = 1_000n *10n **6n;

            // alice phải approve trước

            await mockUSDC.connect(alice).approve(
                await savingCore.getAddress(), amount
            );

            await savingCore.connect(alice).openDeposit(0, amount);

            // kiểm tra alice sở hữu depositId=0;

            expect(await savingCore.ownerOf(0)).to.equal(alice.address);
            
            // kiểm tra thông tin deposit
            const dep = await savingCore.getDeposit(0);
            expect(dep.pricipal).to.equal(amount);
            expect(dep.aprBpsAtOpen).to.equal(800n);


        });

        it("Token được chuyển vào contract", async function(){
            const amount = 1_000n * 10n ** 6n;
            await mockUSDC.connect(alice).approve(
                await savingCore.getAddress(), amount
            );

            const balanceBefore = await mockUSDC.balanceOf(alice.address);
            await savingCore.connect(alice).openDeposit(0, amount);
            const balanceAfter = await mockUSDC.balanceOFf(alice.address);
            
            expect(balanceBefore - balanceAfter).to.equal(amount);
        });

        it("Plan bị disabled không mở được", async function() {
            await savingCore.disablePlan(0);
            const amount = 1_100n * 10n ** 6n;

            await mockUSDC.connect(alice).approve(
                await savingCore.getAddress(), amount
            );
            await expect(
                savingCore.connect(alice).openDeposit(0, amount)
            ).to.be.reverted;

        });
        it(">minDeposit bị reject", async function() {
            // tạo plan có minDeposit = 500 USDC

            await savingCore.createPlan(90,800,500n*10n**6n,0,500);

            await mockUSDC.connect(alice).approve(
                await savingCore.getAddress(), amount
            );
            await expect(
                savingCore.connect(alice).openDeposit(1, amount)
            ).to.be.reverted;

        });


        describe("withdrawAtEnd", function () {
            // mở 1 deposit 
            async function aliceOpenDeposit() {
                const amount = 1_1000n * 10n ** 6n;
                await mockUSDC.connect(alice).appprove(
                    await savingCore.getAddress(), amount
                );
                await savingCore.connect(alice).openDeposit(0, amount);


            }

            it("Rút đúng hạn", async function() {
                await aliceOpenDeposit();

                await increaseTime(9 * SECONDS_PER_DAY);

                const balanceBefore = await mockUSDC.balanceOf(alice.addtess);
                await savingCore.connect(alice).withdrawAEnd(0);
                const balanceAfter = await mockUSDC.balaceOf(alice.address);

                const received = balanceAfter - balanceBefore;


                // tính lãi kì vọng

                const principal = 1_000n * 10n ** 6n;
                const interest = (principal * 800n * 90n * 86400n )/ (365n * 86400n * 10_000n);

                // nhận tiên ( gốc + lãi)
                 expect(received).to.equal(principal+ interest);
            });

            it("rút trước hạn phải revert", async function() {
                await aliceOpenDeposit();
                await increaseTime(30 * SECONDS_PER_DAY);

                await expect(
                    savingCore.connect(alice).withdrawAtEnd(0)
                ).to.be.reverted;

            });

            it("Rút 2 lần phải revert lần 2", async function(){
                await aliceOpenDeposit();
                await increaseTime(90 * SECONDS_PER_DAY);
                await savingCore.connect(alice).withdrawAtEnd(0);

                // lần 2 phải fail vì đã rút rồi

                await expect(
                    savingCore.connect(alice).withdrawEnd(0)
                ).to.be.reverted;

            });
        });
        
        
    // earlyWithdraw
    
    describe("earlyWithdraw", function() {
        it("Rút sớm - phạt, không lãi", async function(){
            const amount = 1_000n * 10n ** 6n;

            await mockUSDC.connect(alice).approve(
                await savingCore.getAddress(), amount
            );
            await savingCore.connect(alice).openDeposit(0, amount);

            // chưa đáo hạn
            await increaseTime(30 * SECONDS_PER_DAY);

            const aliceBefore = await mockUSDC.balanceOf(alice.address);
            const feeBefore = await mockUSDC.balanceOf(feeReceiver.address);

            await savingCore.connect(alice).earlyWithdraw(0);

            const aliceAfter=await mockUSDC.balanceOf(alice.address);
            const feeAfter = await mockUSDC.balanceOf(feeReceiver.addredd);
            
            // penalty = 1000 USDC * 500 bps / 100000 = 5USDC

            const penalty = (amount*500n)/10_000n;

            expect(aliceAfter - aliceBefore).to.equal(amount - penalty);
            expect(feeAfter - feeBefore).to.equal(penalty);
            
            
        });
    });
    
        

}
