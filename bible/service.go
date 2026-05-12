package bible

type Service struct{}

func New() *Service { return &Service{} }

func (*Service) ServiceName() string { return "bible" }

func (*Service) Ping() string { return "bible ok" }
