// SPDX-license-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./VaultManager.sol";

contract SavingCore is ERC721, Ownable, Pausable {
    struct SavingPlan {
        uint256 tenorDays; // số ngày gửi
        uint256 aprBps; // lãi suất hàng năm tính bằng basis points (1% = 100 bps)
        uint256 minDeposit; // số tiền gửi tối thiểu
        uint256 maxDeposit; // số tiền gửi tối đa
        uint256 penDps; // phí phạt khi rút tiền sớm, tính bằng basis points
        bool enabled; // admin có thể bật/tắt kế hoạch gửi này

    }
    /// @notice Trang thái của một deposit
    enum DepositStatus {
        Active, 
        Withdrawn,
        ManualRenewal, // gia han thủ công
        AutoRenawal // gia han tự động
    }
    /// @notice chung chi gửi tiền 
    struct DepositInfo {
        uint256 planId; // plan mà user đã chọn
        uint256 principal; // số tiền gốc đã gửi
        uint256 startAt; // thời gian bắt đầu gửi
        uint256 endAt; // thoi diem dao han
        uint256 aprBpsAtOpen; // lãi suất tại thời điểm mở deposit
        DepositStatus status; // trang thai hien tai cua deposit


    }

    mapping(uint256 => SavingPlan) public plan;
    uint256 public nextPlanId;

    mapping(uint256 => DepositInfo) public deposits;
    uint256 public nextDepositId;

    uint256 public constant GRACE_PERIOD = 3 days;  // thời gian gia hạn sau khi đáo hạn mà user vẫn có thể rút tiền mà không bị phạt


    // event
    event PlanCreated(uint256 indexed planId, uint256 tenorDays, uint256 aprBps);
    event PlanUpdated(uint256 indexed planId, uint256 newAprBps);
    event DepositOpened (

        uint256 indexed depositId,
        uint256 indexed owner,
        uint256 planId,
        uint256 principal,
        uint256 startAt,
        uint256 endAt,
        uint256 aprBpsAtOpen
    );
    event Withdrawn (
        uint256 indexed depositId,
        uint256 indexed owner,
        uint256 principal,
        uint256 interest,
        uint256 isEarly
    );

    event renewed (
        uint256 indexed oldDepositId,
        uint256 indexed newDepositId,
        uint256 newPrincipal,
        uint256 newPlanId

    );

    // Error

    error PlanNotFound(); // bao lỗi khi planId không tồn tại
    error PlanDisabled(); // bao lỗi khi plan bị tắt
    error BelowMitnDeposit(); // bao lỗi khi số tiền gửi nhỏ hơn mức tối thiểu
    error AboveMaxDeposit(); // bao lỗi khi số tiền gửi lớn hơn mức tối đa
    error NotDepositOwner(); // bao lỗi khi người gọi không phải chủ sở hữu của deposit
    error DepositNotActive(); // bao lỗi khi deposit không ở trạng thái Active
    error NotEndAt(); // bao lỗi khi thời điểm hiện tại chưa đến thời điểm đáo hạn
    error AlreadyEndAt(); // bao lỗi khi thời điểm hiện tại đã vượt quá thời điểm đáo hạn
    error GracePeriodNotOver(); // bao lỗi khi thời gian gia hạn chưa kết thúc
    error ZeroAmount(); // bao lỗi khi số tiền gửi hoặc rút là 0
    error ZeroAddress(); // bao lỗi khi địa chỉ là 0


    // contructor

    constructor(
        address _token,
        address _vault
    ) ERC721("Saving Certificate", "SAVE") Ownable(msg.sender) {
        if (_token == address(0)) revert ZeroAddress();
        if (_vault == address(0)) revert ZeroAddress();
        token = IERC20(_token);
        vault = VaultManager(_vault);
        
    }

    /// @notice tao saving plan mới
    function createPlan(
        uint256 tenorDays,
        uint256 aprBps,
        uint256 minDeposit,
        uint256 maxDeposit,
        uint256 penDps
    ) external onlyOwner {
        // xac thuc
        if (tenorDays == 0) revert ZeroAmount();
        if (aprBps == 0) revert ZeroAmount();

        uint planId = nextPlanId++;
        plans[planId] = SavingPlan({
            tenorDays: tenorDays,
            aprBps: aprBps,
            minDeposit: minDeposit,
            maxDeposit: maxDeposit,
            penDps: penDps,
            enabled: true
        });
        emit PlanCreated(planId, tenorDays, aprBps);


    }

    /// @notice cập nhật lãi suất của plan

    function updatePlan(uint256 planId, uint256 newAprBps) external onlyOwner {
        if (newAprBps == 0) revert ZeroAmount();
        plans[planId].aprBps = newAprBps;
        emit PlanUpdated(planId, newAprBps);    
    }

    function enablePlan(uint256 planId) external onlyOwner {
        plans[planId].enabled = true;

    }

    function disablePlan(uint256 planId) external onlyOwner {
        plans[planId].enabled = false;

    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner() { _unpause(); }


    /// @notice user mở deposit mới
    /// @param planId: id của plan mà user chọn
    /// @param amount: số tiền mà user muốn gửi

    function openDeposit(
        uint256 planId,
        uint256 amount

    ) external whenNotPaused {
        SavingPlan memory  plan = plans[planId];
        
        // kiem tra plan hợp lệ
        if (!plan.enabled) revert PlanDisabled();
        if (amount == 0) revert ZeroAmount();
        if (plan.minDeposit > 0 && amount < plan.minDeposit) revert BelowMinDeposit();
        if (plan.maxDeposit > 0 && amount > plan.maxDeposit) revert AboveMaxDeposit();


        // chuyển token từ user vào vault
        // user cần phải approve trước cho contract này để chuyển token
        token.transferFrom(msg.sender, address(this), amount);

        // tinh thoi gian dao han

        uint256 startAt = block.timestamp + plan.tenorDays * 1 days;

        // MintNFT vooi depositId la tokenID
        uint256 depositId = nextDepositId++;
        _mint(msg.sender, depositId);

        // luu thong tin deposit ngay luc nay
        deposits[depositId] = DepositInfo({
            planId: planId,
            principal: amount,
            StartAt: block.timestamp,
            stratAt: startAt,
            aprBpsAtOpen: plan.aprBps,
            penSpsAtOpen: plan.penDps,
            status: DepositStatus.Active

        });

        emit DepositOpened(
            depositId,
            msg.sender,
            planId,
            amount,
            block.timestamp,
            startAt,
            plan.aprBps
        );

    }

    /// @dev nhan truoc chia sau de tranh mat precision khi tinh toan tien lai

    function _calculateInterest(
        uint256 principal,
        uint256 aprBps,
        uint256 tenorSeconds
    ) internal pure returns (uint256) {
        // lai = goc * lai suat * thoi gian / (365 ngay * 10_000)
        return (principal * aprBps * tenorSeconds) / (365 days * 10_000);
        
    }

    // user: withdraw

    ///@notice rut tien sau khi dao han

    function withdrawAtEnd(uint256 depositId) external whenNotPaused {
        // kiem tra quyen so huu
        if (ownerOf(depositId) != msg.sender) revert NotDepositOwner();

        DepositInfo storage dep = deposits[depositId];
        if (dep.status != DepositStatus.Active) revert DepositNotActive();
        if (block.timestamp < dep.endAt) revert NotEndAt();

        // tinh tien lai
        uint256 tenorSeconds = dep.endAt - dep.startAt;
        uint256 interest = _calculateInterest(
            dep.principal,
            dep.aprBpsAtOpen,
            tenorSeconds
        );

    }






}