import {expect} from "chai";
import {ethers } from "hardhat";
import { time }  from "@nomicfoundation/hardhat-network-helpers";
const SECONDS_PER_DAY = 86400;

describe("Blockchain Saving System", function () {
    // biến dùng chung cho tất cả các test;
    let mockUSDC: any;
    let vaultManager: any;
    let savingCore: any;
    let owner: any;
    let alice: any;
    let bob: any;
    let feeReceiver: any;

    // chạy trước mỗi test, đảm bảo mỗi test băt đầu với state sạch
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


      // createPlan 

    describe("createPlan", function() {
        it("Tạo plan hợp lệ ", async function() {
            const plan = await savingCore.getPlan(0); // planId bắt đầu từ 0
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


    // openDeposit

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
        it(" dưới minDeposit bị reject", async function() {
            // tạo plan có minDeposit = 500 USDC

            await savingCore.createPlan(90, 800, 500n * 10n ** 6n,0 , 500);
            const amount = 100n * 10n ** 6n;

            await mockUSDC.connect(alice).approve(
                await savingCore.getAddress(), amount
            );
            await expect(
                savingCore.connect(alice).openDeposit(1, amount)
            ).to.be.reverted;

        });

    });

    // withdrawAtEnd
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

                await time.increase(9 * SECONDS_PER_DAY);

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
                await time.increase(30 * SECONDS_PER_DAY);

                await expect(
                    savingCore.connect(alice).withdrawAtEnd(0)
                ).to.be.reverted;

            });

            it("Rút 2 lần phải revert lần 2", async function(){
                await aliceOpenDeposit();
                await time.increase(90 * SECONDS_PER_DAY);
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
            await time.increase(30 * SECONDS_PER_DAY);

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
    
    // renewDeposit
    describe("renewDeposit", function() {
        it("Gia hạn thủ công", async function () {
            const amount = 1_000n * 10n ** 6n;
            await mockUSDC.connect(alice).approve(
                await savingCore.getAddress(), amount
        );

        await savingCore.connect(alice).openDeposit(0, amount);
        await time.increase(90 * SECONDS_PER_DAY);

        await savingCore.connect(alice).renewDeposit(0,0);

        // deposit mới 
        const newDep = await savingCore.getDeposit(1);
        const interest = (amount * 800n * 90n * 86400n) / (365n * 86400n *10_000n);
        expect(newDep.principal).to.equal(amount + interest);
        expect(newDep.status).to.equal(0n);

    });
    
       it ("Deposit cũ status = ManualRenewed", async function() {
        const amount = 1_000n * 10n ** 6n;
        await mockUSDC.connect(alice).approve(
            await savingCore.getAddress(), amount
        );

       await savingCore.connect(alice).openDeposit(0, amount);
       await time.increase(90 * SECONDS_PER_DAY);
       await savingCore.connect(alice).renewDeposit(0,0);
       const oldDep = await savingCore.getDeposit(0);
       expect(oldDep.status).to.equal(2n);
       });
    });


    // autoRenewDeoposit

    describe("autoRenewDeposit", function() {
        async function aliceOpenDeposit() {
            const amount = 1_000n * 10n ** 6n;
            await mockUSDC.connect(alice).approve(
                await savingCore.getAddress(), amount
            );
            await savingCore.connect(alice).openDeposit(0, amount);
        }

        it ("Auto renew trước đáo hạn phải revert", async function() {
            await aliceOpenDeposit();
            await time.increase(90 * SECONDS_PER_DAY);

            await expect(
                savingCore.autoRenewDeposit(0)
            ).to.be.reverted;
        });

        it("Auto renew sau khi đáo hạn thành công", async function(){
            await aliceOpenDeposit();
            await time.increase(93 * SECONDS_PER_DAY + 1); // thời gian  gia hạn sau khi đáo hạn tối đa 3 ngày 
        
            const oldDep = await savingCore.getDeposit(0);
            expect(oldDep.status).to.equal(3n);

        });

        it("APR được giữ nguyên sau khi auto renew", async function() {
            await aliceOpenDeposit();
            // Admin giảm lãi suất xuống còn 1%
            await savingCore.updatePlan(0, 100);

            await time.increase(93 * SECONDS_PER_DAY + 1);
            await savingCore.autoRenewDeposit(0);

            const newDep =await savingCore.getDeposit(1);
            expect(newDep.aprBpsAtOpen).to.equal(800n);
    
        });

    });

    // vault

    describe("Vault", function() {
        it(" Vault tăng balance ", async function() {
            const extra = 1_000n * 10n ** 6n;
            await mockUSDC.approve(await vaultManager.getAddress(), extra);
            await vaultManager.fundVault(extra);

            expect(await vaultManager.vaultBalance())
            .to.equal(101_000n *10n **6n);
        });


        it ("Vault không đủ tiền -> withdrawal revert", async function(){
            // rút hết tiền của vault
            await vaultManager.withdrawVault(await vaultManager.vaultBalance());
            
            const amount = 1_000n * 10n ** 6n;
            await mockUSDC.connect(alice).approve(
                await savingCore.getAddress(), amount
            );
            await savingCore.connect(alice).openDeposit(0, amount);
            await time.increase(90 * SECONDS_PER_DAY);

            await expect(
                savingCore.connect(alice).withdrawAtEnd(0)
            ).to.be.reverted;

        });

    
    });


    // Pause

    describe("Pause", function() {
        it("Không thể withdraw khi paused", async function() {
            const amount = 1_000n * 10n ** 6n;
            await mockUSDC.connect(alice).approve(
                await savingCore.getAddress(), amount
            );
            await savingCore.connect(alice).openDeposit(0, amount);
            await time.increase(90 * SECONDS_PER_DAY);

            // addmin pause hệ thống
            await savingCore.pause();

            await expect(
                savingCore.connect(alice).withdrawAtEnd(0)
            ).to.be.reverted;

        });
        it ("có thể withdraw sau khi unpause", async function () {
            const amount = 1_000n * 10n ** 6n;
            await mockUSDC.connect(alice).approve(
                await savingCore.getAddress(), amount
            );
            await savingCore.connect(alice).openDeposit(0, amount);
            await time.increase(90 * SECONDS_PER_DAY);

            await savingCore.pause();
            await savingCore.unpause();

            // 

            await expect(
                savingCore.connect(alice).withdrawAtEnd(0)
            ).to.be.reverted;
        });

    });

});
