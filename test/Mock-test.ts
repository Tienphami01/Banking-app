import { expect } from "chai";
import { network } from "hardhat";
const { ethers } = await network.create(); 

describe("MockUSDC", () => {
  // Biến dùng chung cho nhiều test
  let owner: any;
  let user: any;
  let mockUSDC: any;

  beforeEach(async () => {
    // Lấy danh sách account
    [owner, user] = await ethers.getSigners();

    // Lấy factory của contract
    const MockUSDC = await ethers.getContractFactory("MockUSDC");

    // Deploy contract
    mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();
  });

  it("mints tokens to an address", async () => {
    const amount = 1_000_000n; // 1 token với 6 decimals

    // Gọi hàm mint
    await mockUSDC.mint(user.address, amount);

    // Kiểm tra balance
    const balance = await mockUSDC.balanceOf(user.address);
    expect(balance).to.equal(amount);
  });
});